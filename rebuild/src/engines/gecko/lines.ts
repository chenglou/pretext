// Line filling for Gecko (Firefox 156.0): nsBlockFrame::ReflowInlineFrames with at most one redo, nsLineLayout's per-span
// line data (BeginSpan, EndSpan), ReflowFrame, CanPlaceFrame, PlaceFrame and NotifyOptionalBreakPosition,
// nsInlineFrame::ReflowFrames, nsTextFrame::ReflowText, gfxTextRun::BreakAndMeasureText, TrimTrailingWhiteSpaceIn,
// TextAlignLine and nsBidiPresUtils::ReorderFrames. specs/gecko-lines.md §4-§6; widths are integer app units throughout
// (§2.8). A line returns the frames Gecko placed on it (DESIGN.md §2.5), and fragments classified by the frames' own flags.
import { measureContext, measureText, measureTextBounds, type Measurer } from '../../measure/canvas.js'
import type { Fragment, Gap, GeckoCharacter, GeckoFrameGeometry, GeckoLine, GeckoLineResult, LineSlot, TextAlign } from '../../model.js'
import { BREAK_EMERGENCY_WRAP, BREAK_NORMAL } from './linebreak.js'
import { frameOfSource, isTrimmableChar, pxToAu, rangeAu } from './prepare.js'
import { generalCategory, isBidiControl, isClusterExtenderExcludingJoiners, joiningType } from './props.js'
import { KIND_NEWLINE, KIND_TAB, type GeckoElement, type GeckoLineStart, type GeckoPrepared, type GeckoTextRun } from './types.js'

const SHY = 0x00ad
const NO_BREAK = 0 // gfxBreakPriority (gfxTypes.h:48)
const WORD_WRAP_BREAK = 1
const NORMAL_BREAK = 2
// The offset NotifyOptionalBreakPosition takes for "after the content" of a frame that isn't text (nsLineLayout.cpp:1057-1066).
const AFTER_CONTENT = 0x7fffffff

// The gaps one line's filling runs into (DESIGN.md §2.8). `inWord` holds every in-word offset the line's passes consulted
// whose advance Canvas can't confirm, by source offset, with the reason; the line reports those that decide it (lineOutput).
type LineGaps = { list: Gap[]; inWord: Map<number, string> }

// A ligature across offset t inside a shaping unit: the grapheme clusters on both sides of t measure differently, in width or
// ink box, with ligatures off. letterSpacing 0.001px turns liga, clig, dlig and hlig off in Gecko's Canvas and adds no app
// unit (specs/gecko-canvas.md §1.10). The DOM gives a range edge inside a ligature the ligature's advance in shares by
// started clusters (ComputeLigatureData, gfxTextRun.cpp:238-322), which W(unit) − W(suffix) doesn't. Probe gecko-port F9
// (.artifacts/probes/gecko/round2): `fi` in 14px "Helvetica Neue" is 435 au either way, as wide as `f` and `i` apart, but its
// ink box ends at 438 au with ligatures and 438.36 without; the DOM gives `f` 217 au and `i` 218 inside `firstname`, where
// the recipe gives 249 and 186. Necessary, not sufficient: a ligature that moves neither the pair's width nor its box, or
// one that begins more than a cluster before t, doesn't show. A run with letter spacing has ligatures off in the DOM too
// (nsLayoutUtils.cpp:6901-6904).
function ligatureAcross(p: GeckoPrepared, m: Measurer, run: GeckoTextRun, unit: { tStart: number; tEnd: number }, t: number): boolean {
  const settings = m.log.contexts[run.context]!
  if (settings.letterSpacing !== '0px') return false
  let a = t - 1
  while (a > unit.tStart && p.clusterStart[a] === 0) a--
  let b = t + 1
  while (b < unit.tEnd && p.clusterStart[b] === 0) b++
  let pair = ''
  for (let k = a; k < b; k++) pair += String.fromCharCode(p.tUnits[k]!)
  // The answer depends only on the context and the string, and a line consults an offset several times (the scan, the
  // measured edges, the redo): answer each once per measurer.
  let memo = ligatureMemo.get(m)
  if (memo === undefined) ligatureMemo.set(m, memo = new Map())
  const key = `${run.context} ${pair}`
  const known = memo.get(key)
  if (known !== undefined) return known
  const on = measureTextBounds(m, run.context, pair)
  const off = measureTextBounds(m, measureContext(m, { ...settings, letterSpacing: '0.001px' }), pair)
  const differs = on.width !== off.width || on.left !== off.left || on.right !== off.right
  memo.set(key, differs)
  return differs
}
const ligatureMemo = new WeakMap<Measurer, Map<string, boolean>>()

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
type InWordAdvance = { au: number; standIn: string | null }
const inWordMemo = new WeakMap<GeckoPrepared, Map<number, InWordAdvance>>()
const ZWJ = '\u200d'

function advanceBefore(p: GeckoPrepared, m: Measurer, run: GeckoTextRun, t: number): InWordAdvance {
  if (t >= run.tEnd) return { au: run.totalAdvance, standIn: null }
  const unit = p.units[p.unitOf[t]!]!
  if (t === unit.tStart) return { au: unit.startAdvance, standIn: null }
  let memo = inWordMemo.get(p)
  if (memo === undefined) inWordMemo.set(p, memo = new Map())
  let value = memo.get(t)
  if (value === undefined) memo.set(t, value = inWordAdvance(p, m, run, unit, t))
  return value
}

function inWordAdvance(p: GeckoPrepared, m: Measurer, run: GeckoTextRun, unit: { tStart: number; tEnd: number; canvasAu: number; startAdvance: number }, t: number): InWordAdvance {
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
    let end = t + 1
    while (end < unit.tEnd && p.clusterStart[end] === 0) end++
    const inner = advanceBefore(p, m, run, end)
    return { au: inner.au, standIn: `offset ${p.tSource[t]} inside a grapheme cluster: the DOM divides the cluster's advance by its glyph records and ligature groups, which Canvas can't show (gfxHarfBuzzShaper.cpp:1705-1786, gfxTextRun.cpp:238-322)` }
  }
  const joiner = joinsAcross(p, unit, t) ? ZWJ : ''
  // A ligature group over t: the DOM gives a range edge inside it the group's advance in equal shares per started cluster,
  // the rounding left to the last part (ComputeLigatureData, gfxTextRun.cpp:238-322). The group reaches as far as Canvas
  // shows one at each offset on the way (groupSpans), and its advance is what lies between its two ends, which are offsets
  // like any other. Probe gecko-port F17: lam and alef in 16px Geeza Pro are 280 and 281 au of a 561 au group, lam lam heh
  // 223 au each of 669, U+0E24 U+0E32 in 20px Thonburi 663 each; F9: `f` 217 and `i` 218 au of "Helvetica Neue"'s 435 au `fi`.
  const group = groupAround(p, m, run, unit, t)
  if (group !== null) {
    const from = advanceBefore(p, m, run, group.start)
    const to = advanceBefore(p, m, run, group.end)
    let clusters = 0
    let before = 0
    for (let k = group.start; k < group.end; k++) {
      if (p.clusterStart[k] === 0 && k !== group.start) continue
      clusters++
      if (k < t) before++
    }
    const edges = from.standIn ?? to.standIn
    return {
      au: from.au + before * Math.floor((to.au - from.au) / clusters),
      standIn: edges === null ? null : `offset ${p.tSource[t]} inside a ligature group whose ends Canvas can't confirm: ${edges}`,
    }
  }
  const corrections = p.correctionPrefix[t]! - p.correctionPrefix[unit.tStart]!
  const reversed = shapedReversed(p, run, unit, t)
  const suffixAu = rangeAu(m, run, p.tUnits, t, unit.tEnd, joiner, '')
  // What the unit's shaping moves across t, and the prefix's advance if nothing does.
  let across: number
  let prefixAu: number
  let sides: string
  let a = t - 1
  while (a > unit.tStart && p.clusterStart[a] === 0) a--
  const before = joiningType(codePointAtT(p, a))
  if (joiner !== '' || reversed || before === 'R' || before === 'D' || before === 'L' || before === 'C') {
    // The two sides as the unit shapes them: with U+200D at the cut between joined letters.
    prefixAu = rangeAu(m, run, p.tUnits, unit.tStart, t, '', joiner)
    across = unit.canvasAu - prefixAu - suffixAu
    sides = joiner !== '' ? `letters join across it, and W(prefix U+200D) + W(U+200D suffix) = ${prefixAu + suffixAu} au` : `W(prefix) + W(suffix) = ${prefixAu + suffixAu} au`
  } else {
    // Where the cluster before t has no joining forms, it shapes alone as it does after its own neighbour, and put in front
    // of the suffix it shows the same thing: what the two gain from each other is W(cluster and suffix) − W(suffix) −
    // W(cluster). That asks Canvas for one long string per offset instead of two, and the offset before it has asked for
    // the other already (a paragraph of 9,428 Han characters is one unit). A letter with joining forms takes the form its
    // own neighbour gives it, and what it gains from the suffix goes by that form (fresh c-b44094d264947ac3: a final alef
    // before lam in 16px Amiri is 220 au, where alef alone in front of the suffix adds its isolated 217 au).
    const withCluster = a === unit.tStart ? unit.canvasAu : rangeAu(m, run, p.tUnits, a, unit.tEnd)
    across = withCluster - suffixAu - rangeAu(m, run, p.tUnits, a, t)
    prefixAu = unit.canvasAu - suffixAu - across
    sides = `W(cluster before it and suffix) − W(suffix) − W(cluster) = ${across} au`
  }
  if (across !== 0 && joiner === '' && !reversed) {
    // The sides don't add up, and the font's pair kerning says where an adjustment across t goes: the advance is exact where
    // Canvas shows the difference is that pair's adjustment and no ligature group spans t.
    const after = pairKernedShare(p, m, run, unit, t, across)
    if (after !== null) {
      return { au: unit.startAdvance + unit.canvasAu - suffixAu - after + corrections, standIn: null }
    }
  }
  const standIn = across !== 0 ? `offset ${p.tSource[t]}: ${sides}, W(unit) = ${unit.canvasAu} au` : null
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
  else if (run.pairKerning === 'split' && joiner === '') au = prefixAu + (across >> 1)
  else au = unit.canvasAu - suffixAu
  return { au: unit.startAdvance + au + corrections, standIn }
}

// Where a pair adjustment crosses t: the part of it that lands after t, on the suffix's first glyph, or null where Canvas
// can't confirm it. The advance before t is then W(unit) − W(suffix) less that part, since the suffix measured alone lacks
// exactly it. R = W(cluster before t and suffix) − W(suffix) − W(cluster) is what the pair moves, in app units rounded per
// glyph.
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
//   where each rounding is further from a tie than its inputs' reach and the terms add up to R. Probe gecko-port F16
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
function pairKernedShare(p: GeckoPrepared, m: Measurer, run: GeckoTextRun, unit: { tStart: number; tEnd: number }, t: number, R: number): number | null {
  if (run.pairKerning === null) return null
  let a = t - 1
  while (a > unit.tStart && p.clusterStart[a] === 0) a--
  let b = t + 1
  while (b < unit.tEnd && p.clusterStart[b] === 0) b++
  let b1 = b
  if (b < unit.tEnd) { b1 = b + 1; while (b1 < unit.tEnd && p.clusterStart[b1] === 0) b1++ }
  for (let k = a; k < b1; k++) if (p.tUnits[k]! < 0x21 || p.tUnits[k]! > 0x7e) return null
  const alone = rangeAu(m, run, p.tUnits, a, b) - rangeAu(m, run, p.tUnits, a, t) - rangeAu(m, run, p.tUnits, t, b)
  if (run.pairKerning === 'first-advance') return alone === R ? 0 : null
  if (Math.abs(alone - R) > 2) return null
  if (R % 2 === 0) return R / 2
  // An odd adjustment: the fractions, from the run's context at 2^k times its font size. gfxFont clamps a font's size at
  // 2000px (gfxFont.cpp:4956-4960).
  const settings = m.log.contexts[run.context]!
  const size = /(\d+(?:\.\d+)?)px/.exec(settings.font)
  if (size === null || !(Number(size[1]) > 0)) return null
  let k = 0
  while (Number(size[1]) * 2 ** (k + 1) <= 2000) k++
  if (k < 3) return null
  const scale = 2 ** k
  const large = { ...run, context: measureContext(m, { ...settings, font: settings.font.replace(size[0], `${String(Number(size[1]) * scale)}px`) }) }
  const w = (from: number, to: number): number => rangeAu(m, large, p.tUnits, from, to) / scale
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

// Whether Canvas shows a ligature group over cluster boundary t: an optional ligature (ligatureAcross) or a group required
// shaping forms (groupAcross).
function groupSpans(p: GeckoPrepared, m: Measurer, run: GeckoTextRun, unit: { tStart: number; tEnd: number }, t: number): boolean {
  let memo = spansMemo.get(p)
  if (memo === undefined) spansMemo.set(p, memo = new Map())
  let spans = memo.get(t)
  if (spans === undefined) {
    spans = ligatureAcross(p, m, run, unit, t) || groupAcross(p, m, run, unit, t, joinsAcross(p, unit, t) ? ZWJ : '')
    memo.set(t, spans)
  }
  return spans
}
const spansMemo = new WeakMap<GeckoPrepared, Map<number, boolean>>()

// The ligature group over cluster boundary t, or null: it runs from the nearest cluster boundary before t that no group
// spans, or the unit's start, to the nearest such boundary after t, or the unit's end.
function groupAround(p: GeckoPrepared, m: Measurer, run: GeckoTextRun, unit: { tStart: number; tEnd: number }, t: number): { start: number; end: number } | null {
  if (!groupSpans(p, m, run, unit, t)) return null
  let start = t
  do {
    start--
    while (start > unit.tStart && p.clusterStart[start] === 0) start--
  } while (start > unit.tStart && groupSpans(p, m, run, unit, start))
  let end = t
  do {
    end++
    while (end < unit.tEnd && p.clusterStart[end] === 0) end++
  } while (end < unit.tEnd && groupSpans(p, m, run, unit, end))
  return { start, end }
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
function groupAcross(p: GeckoPrepared, m: Measurer, run: GeckoTextRun, unit: { tStart: number; tEnd: number }, t: number, joiner: string): boolean {
  const settings = m.log.contexts[run.context]!
  const spaced = { ...run, context: measureContext(m, { ...settings, letterSpacing: '2px' }) }
  const off = { ...run, context: measureContext(m, { ...settings, letterSpacing: '0.001px' }) }
  const groups = (tStart: number, tEnd: number, before: string, after: string): number =>
    (rangeAu(m, spaced, p.tUnits, tStart, tEnd, before, after) - rangeAu(m, off, p.tUnits, tStart, tEnd, before, after)) / (2 * run.auPerPx)
  let memo = groupMemo.get(p)
  if (memo === undefined) groupMemo.set(p, memo = new Map())
  let counts = memo.get(unit.tStart)
  if (counts === undefined) {
    let clusters = 0
    for (let k = unit.tStart; k < unit.tEnd; k++) clusters += p.clusterStart[k]!
    memo.set(unit.tStart, counts = { groups: groups(unit.tStart, unit.tEnd, '', ''), clusters })
  }
  const inUnit = counts.groups
  if (inUnit === counts.clusters) return false
  // U+200D before the suffix is a cluster of its own, which the joiner measured alone counts too.
  const joinerGroups = joiner === '' ? 0 : (Math.round(measureText(m, spaced.context, joiner) * run.auPerPx) - Math.round(measureText(m, off.context, joiner) * run.auPerPx)) / (2 * run.auPerPx)
  return groups(unit.tStart, t, '', joiner) + groups(t, unit.tEnd, joiner, '') - joinerGroups !== inUnit
}
const groupMemo = new WeakMap<GeckoPrepared, Map<number, { groups: number; clusters: number }>>()

// `gaps` is the line whose breaks consult t, or null where the advance only places geometry.
function glyphBefore(p: GeckoPrepared, m: Measurer, run: GeckoTextRun, t: number, gaps: LineGaps | null): number {
  const value = advanceBefore(p, m, run, t)
  if (gaps !== null && value.standIn !== null) {
    const s = p.tSource[t]!
    if (!gaps.inWord.has(s)) gaps.inWord.set(s, value.standIn)
  }
  return value.au
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
function shapedReversed(p: GeckoPrepared, run: GeckoTextRun, unit: { tStart: number; tEnd: number }, t: number): boolean {
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

function codePointAtT(p: GeckoPrepared, i: number): number {
  const u = p.tUnits[i]!
  if ((u & 0xfc00) === 0xdc00 && i > 0 && (p.tUnits[i - 1]! & 0xfc00) === 0xd800) return 0x10000 + ((p.tUnits[i - 1]! - 0xd800) << 10) + (u - 0xdc00)
  if ((u & 0xfc00) === 0xd800 && i + 1 < p.tUnits.length && (p.tUnits[i + 1]! & 0xfc00) === 0xdc00) return 0x10000 + ((u - 0xd800) << 10) + (p.tUnits[i + 1]! - 0xdc00)
  return u
}

// A cursive connection across offset t inside a unit: the last non-transparent letter before t joins to its following
// side and the first non-transparent letter from t joins to its preceding side (Joining_Type, ArabicShaping.txt).
function joinsAcross(p: GeckoPrepared, unit: { tStart: number; tEnd: number }, t: number): boolean {
  let a = t - 1
  while (a > unit.tStart && joiningType(codePointAtT(p, a)) === 'T') a--
  let b = t
  while (b + 1 < unit.tEnd && joiningType(codePointAtT(p, b)) === 'T') b++
  const left = joiningType(codePointAtT(p, a))
  const right = joiningType(codePointAtT(p, b))
  return (left === 'D' || left === 'L' || left === 'C') && (right === 'D' || right === 'R' || right === 'C')
}

// The text run holding transformed index t.
function textRunAt(p: GeckoPrepared, t: number): GeckoTextRun | null {
  for (let r = 0; r < p.textRuns.length; r++) {
    const run = p.textRuns[r]!
    if (t >= run.tStart && t < run.tEnd) return run
  }
  return null
}

// A frame's measuring context: nsTextFrame::PropertyProvider (nsTextFrame.cpp:3472-3500) with its tab widths.
type Provider = {
  run: GeckoTextRun
  frame: number
  // Source offset and length of the measured content (after leading white space was skipped).
  start: number
  length: number
  startT: number
  startOfLine: boolean
  letterSpacingAu: number
  tabs: Map<number, number>
}

function rangeAdvance(p: GeckoPrepared, m: Measurer, prov: Provider, a: number, b: number, gaps: LineGaps | null): number {
  if (b <= a) return 0
  let w = glyphBefore(p, m, prov.run, b, gaps) - glyphBefore(p, m, prov.run, a, gaps) + p.spacingPrefix[b]! - p.spacingPrefix[a]!
  if (prov.run.hasTab) for (const [t, tab] of prov.tabs) if (t >= a && t < b) w += tab
  return w
}

// BreakAndMeasureText's running width: GetAdvanceForGlyph per character, a ligature group's whole advance on its first
// character, with spacing and tabs; only a group the scanned range starts inside goes by shares (the ligature range,
// gfxTextRun.cpp:989-1000, :1139-1159). So a position inside a group that starts at or after `from` counts the whole group
// (policy c-5ba3b0da55cb63ad: after alef, 16px Geeza Pro's lam lam heh scans as 669 au at once and goes to the next line).
function scanAdvance(p: GeckoPrepared, m: Measurer, prov: Provider, from: number, a: number, b: number, gaps: LineGaps): number {
  const position = (t: number): number => {
    if (t < prov.run.tEnd && p.clusterStart[t] === 1) {
      const unit = p.units[p.unitOf[t]!]!
      if (t > unit.tStart) {
        const group = groupAround(p, m, prov.run, unit, t)
        if (group !== null && group.start >= from) return glyphBefore(p, m, prov.run, group.end, gaps)
      }
    }
    return glyphBefore(p, m, prov.run, t, gaps)
  }
  if (b <= a) return 0
  let w = position(b) - position(a) + p.spacingPrefix[b]! - p.spacingPrefix[a]!
  if (prov.run.hasTab) for (const [t, tab] of prov.tabs) if (t >= a && t < b) w += tab
  return w
}

// GetAdvanceWidth and MeasureText: partial ligature shares at the range ends (gfxTextRun.cpp:238-329, :1195, :1214-1256).
function advanceWidth(p: GeckoPrepared, m: Measurer, prov: Provider, a: number, b: number, gaps: LineGaps | null): number {
  return rangeAdvance(p, m, prov, a, b, gaps)
}

// CalcTabWidths and AdvanceToNextTab (nsTextFrame.cpp:4298-4378): tab stops from the block's content edge.
function computeTabs(p: GeckoPrepared, m: Measurer, prov: Provider, end: number, xForTabs: number, gaps: LineGaps): void {
  // GetSpacing calls CalcTabWidths only for a positive tab width (nsTextFrame.cpp:4306-4309): tab-size 0, or letter
  // spacing below minus the space width, leaves tabs at 0.
  if (!prov.run.hasTab || p.tabWidth <= 0) return
  let x = xForTabs
  let from = prov.startT
  for (let t = prov.startT; t < end; t++) {
    if (p.kind[t] !== KIND_TAB) continue
    x += glyphBefore(p, m, prov.run, t, gaps) - glyphBefore(p, m, prov.run, from, gaps) + p.spacingPrefix[t]! - p.spacingPrefix[from]!
    const nextTab = Math.ceil((x + prov.run.minTabAdvance) / p.tabWidth) * p.tabWidth
    const w = Math.trunc(nextTab - x + (nextTab - x >= 0 ? 0.5 : -0.5)) // NSToIntRound
    prov.tabs.set(t, w)
    x = nextTab + p.spacingPrefix[t + 1]! - p.spacingPrefix[t]!
    from = t + 1
  }
}

// GetHyphenationBreaks (nsTextFrame.cpp:4409-4457): a soft opportunity before the first kept character after skipped
// characters ending in SHY, inside this frame's measured content, not at the frame start of a line-starting frame, and
// only where the frame's white-space wraps.
function hyphenSoft(p: GeckoPrepared, prov: Provider, t: number): boolean {
  if (!p.runStyles[p.frames[prov.frame]!.run]!.wrap) return false
  const s = p.tSource[t]! - 1
  if (s < prov.start || s >= prov.start + prov.length || p.text.charCodeAt(s) !== SHY) return false
  return !prov.startOfLine || t > prov.startT
}

type Measured = {
  charsFit: number
  advance: number
  trimmableChars: number
  trimmableAdvance: number
  usedHyphenation: boolean
  lastBreak: number // -1 for UINT32_MAX, -2 when not everything fit
  breakPriority: number
}

// gfxTextRun::BreakAndMeasureText (gfxTextRun.cpp:922-1212), hyphens manual.
function breakAndMeasureText(p: GeckoPrepared, m: Measurer, prov: Provider, aStart: number, aMaxLength: number,
  aWidth: number, suppress: 'none' | 'initial', canWordWrap: boolean, canWhitespaceWrap: boolean, isBreakSpaces: boolean,
  wantTrimmable: boolean, priorityIn: number, gaps: LineGaps): Measured {
  const run = prov.run
  aMaxLength = Math.min(aMaxLength, run.tEnd - aStart)
  const end = aStart + aMaxLength
  const haveHyphenation = run.hasShy
  const hyphenWidth = run.hyphenAu + prov.letterSpacingAu // GetHyphenWidth (nsTextFrame.cpp:4388-4399)
  let breakPriority = priorityIn
  let width = 0
  let pending = aStart
  let trimmableChars = 0
  let trimStart = aStart
  let lastBreak = -1
  let lbChars = -1
  let lbAdvance = -1
  let lbHyphen = false
  let candBreak = -1
  let candChars = -1
  let candAdvance = -1
  let candHyphen = false
  let candPriority = NO_BREAK
  let aborted = false
  for (let i = aStart; i < end; i++) {
    if (suppress !== 'initial' || i > aStart) {
      const atNaturalBreak = p.breakFlags[i] === BREAK_NORMAL
      const atHyphenationBreak = !atNaturalBreak && haveHyphenation && (!prov.startOfLine || i > aStart) && hyphenSoft(p, prov, i)
      const atBreak = atNaturalBreak || atHyphenationBreak
      const wordWrapping = (canWordWrap || (canWhitespaceWrap && p.breakFlags[i] === BREAK_EMERGENCY_WRAP)) &&
        p.clusterStart[i] === 1 && breakPriority <= WORD_WRAP_BREAK
      const whitespaceWrapping = i > aStart && isBreakSpaces &&
        (p.isSpace[i - 1] === 1 || p.kind[i - 1] === KIND_TAB || p.kind[i - 1] === KIND_NEWLINE)
      if (atBreak || wordWrapping || whitespaceWrapping) {
        const pendingAdvance = scanAdvance(p, m, prov, aStart, pending, i, gaps)
        const trimmableAdvance = trimmableChars > 0 ? scanAdvance(p, m, prov, aStart, trimStart, i, gaps) : 0
        const hyphenatedAdvance = pendingAdvance + (atHyphenationBreak ? hyphenWidth : 0)
        if (lastBreak < 0 || width + hyphenatedAdvance - trimmableAdvance <= aWidth) {
          lastBreak = i
          lbChars = trimmableChars
          lbAdvance = trimmableAdvance
          lbHyphen = atHyphenationBreak
          breakPriority = atBreak || whitespaceWrapping ? NORMAL_BREAK : WORD_WRAP_BREAK
        }
        width += pendingAdvance
        pending = i
        if (width - trimmableAdvance > aWidth) {
          aborted = true
          break
        }
        candBreak = lastBreak
        candChars = lbChars
        candAdvance = lbAdvance
        candHyphen = lbHyphen
        candPriority = breakPriority
      }
    }
    if (wantTrimmable) {
      if (p.isSpace[i] === 1) {
        if (trimmableChars === 0) trimStart = i
        trimmableChars++
      } else {
        trimmableChars = 0
      }
    }
  }
  const scanEnd = aborted ? pending : end
  if (!aborted) width += scanAdvance(p, m, prov, aStart, pending, end, gaps)
  let trimmableAdvance = trimmableChars > 0 ? scanAdvance(p, m, prov, aStart, trimStart, scanEnd, gaps) : 0
  let charsFit: number
  let usedHyphenation = false
  if (width - trimmableAdvance <= aWidth) {
    charsFit = aMaxLength
  } else if (lastBreak >= 0) {
    if (candBreak >= 0 && candBreak !== lastBreak) {
      lastBreak = candBreak
      lbChars = candChars
      lbAdvance = candAdvance
      lbHyphen = candHyphen
      breakPriority = candPriority
    }
    charsFit = lastBreak - aStart
    trimmableChars = lbChars
    trimmableAdvance = lbAdvance
    usedHyphenation = lbHyphen
  } else {
    charsFit = aMaxLength
  }
  return {
    charsFit, advance: advanceWidth(p, m, prov, aStart, aStart + charsFit, gaps), trimmableChars, trimmableAdvance, usedHyphenation,
    lastBreak: charsFit === aMaxLength ? (lastBreak < 0 ? -1 : lastBreak - aStart) : -2, breakPriority,
  }
}

// A saved or forced break position: the frame (an item index plus, for a text continuation, its content start) and the
// offset, relative to the frame's measured start for text, AFTER_CONTENT after another frame, 0 before the line's first frame.
type BreakPosition = { item: number; contentStart: number; offset: number }

// nsLineLayout::PerSpanData (nsLineLayout.h), in the span's own coordinates: the root span from the band's start, a child
// span from its frame's border-box start.
type SpanData = {
  element: number
  iStart: number
  iCoord: number
  iEnd: number
  inset: number
  noWrap: boolean
  frames: Placed[]
  hasNonemptyContent: boolean
  parent: SpanData | null
}

// nsLineLayout::PerFrameData for each placed frame: its inline start in its span's coordinates after the start margin, and
// its inline size.
type PlacedText = {
  kind: 'text'; item: number; r: FrameResult; iStart: number; iSize: number; trimDelta: number; trimmedEnd: number
  // TEXT_END_OF_LINE: TrimTrailingWhiteSpace ran on the frame (nsTextFrame.cpp:11549); the justification info after
  // CancelOpportunityForTrimmedSpace (nsLineLayout.cpp:2943); the gaps the line assigned to its sides.
  endOfLine: boolean; justification: Justification; assign: Assignment
}
type PlacedSpan = {
  kind: 'span'; item: number; element: number; span: SpanData; iStart: number; iSize: number; startMargin: number; endMargin: number
  hasStartEdge: boolean; hasEndEdge: boolean; innerOpportunities: number
  // Whether the frame has a previous continuation (from an earlier line or a bidi split) and a next one.
  hasPrevContinuation: boolean; hasNextContinuation: boolean
}
type PlacedLeaf = { kind: 'atomic' | 'br' | 'wbr'; item: number; element: number; iStart: number; iSize: number; startMargin: number; endMargin: number; assign: Assignment }
type Placed = PlacedText | PlacedSpan | PlacedLeaf

type LineLayout = {
  root: SpanData
  lineIsEmpty: boolean
  lineAtStart: boolean
  totalPlaced: number
  trimmableISize: number
  needBackup: boolean
  lastOpt: BreakPosition | null
  lastOptPriority: number
  force: BreakPosition | null
  impactedByFloats: boolean
  lineEndsInBR: boolean
  lineWrapped: boolean
}

// nsLineLayout::NotifyOptionalBreakPosition (nsLineLayout.cpp:1495-1516): whether the forced break is here.
function notifyOptionalBreak(ll: LineLayout, at: BreakPosition, fits: boolean, priority: number): boolean {
  if ((fits && priority >= ll.lastOptPriority) || ll.lastOpt === null) {
    ll.lastOpt = at
    ll.lastOptPriority = priority
  }
  return ll.force !== null && ll.force.item === at.item && ll.force.contentStart === at.contentStart && ll.force.offset === at.offset
}

type FrameResult = {
  frame: number
  item: number
  contentStart: number
  offset: number
  length: number
  charsFit: number
  contentLength: number
  // The transformed index where the frame's content ends.
  tEnd: number
  advance: number
  width: number
  nonEmpty: boolean
  usedHyphenation: boolean
  brokeText: boolean
  trimmedTrailingWhitespace: boolean
  trimmableChars: number
  // The HangableWhitespaceProperty ReflowText records under pre-wrap (nsTextFrame.cpp:11214-11229), 0 when cleared.
  hangableISize: number
  status: 'complete' | 'break-before' | 'break-after'
  incomplete: boolean
  endsInNewline: boolean
  prov: Provider | null
  // The frame's justification opportunities over its fitted content, computed when the block justifies
  // (nsTextFrame.cpp:11513-11521).
  justification: Justification
  // The TrimmableWS property ReflowText keeps for a justified frame whose trailing white space hangs: the whole trailing
  // white space's advance and count (nsTextFrame.cpp:11214-11232), null when cleared.
  trimmableWS: { advance: number; count: number } | null
}

// JustificationInfo (JustificationUtils.h): opportunities strictly inside a frame, and whether its start and end are
// justifiable.
type Justification = { inner: number; startJustifiable: boolean; endJustifiable: boolean }
// JustificationAssignment: gaps at a frame's or character's sides.
type Assignment = { start: number; end: number }
const NO_JUSTIFICATION: Justification = { inner: 0, startJustifiable: false, endJustifiable: false }

// IsJustifiableCharacter with text-justify: auto (nsTextFrame.cpp:3332-3406): white space the frame doesn't preserve,
// spaces and NBSP not combined with a mark, and, for Chinese or Japanese text, the CJK ranges.
function isJustifiableCharacter(p: GeckoPrepared, s: number, frameEnd: number, is8bit: boolean, significant: boolean, cj: boolean): boolean {
  const ch = p.text.charCodeAt(s)
  if (ch === 0x0a || ch === 0x09 || ch === 0x0d) return !significant
  if (ch === 0x20 || ch === 0xa0) {
    if (is8bit) return true
    for (let i = s + 1; i < frameEnd; i++) {
      const u = p.text.charCodeAt(i)
      if (isClusterExtenderExcludingJoiners(u)) return false // nsTextFrameUtils::IsSpaceCombiningSequenceTail
      if (!isBidiControl(u)) break
    }
    return true
  }
  if (ch < 0x2150) return false
  if (!cj) return false
  if ((ch >= 0x2150 && ch <= 0x22ff) || (ch >= 0x2460 && ch <= 0x24ff) || (ch >= 0x2580 && ch <= 0x27bf) || (ch >= 0x27f0 && ch <= 0x2bff) ||
    (ch >= 0x2e80 && ch <= 0x312f) || (ch >= 0x3190 && ch <= 0xabff) || (ch >= 0xf900 && ch <= 0xfaff) || (ch >= 0xff5e && ch <= 0xff9f)) return true
  if ((ch & 0xfc00) === 0xd800) {
    const u = p.text.codePointAt(s)!
    return u >= 0x20000 && u <= 0x2ffff
  }
  return false
}

// nsTextFrame::PropertyProvider::ComputeJustification over source [rangeStart, rangeEnd) of a frame
// (nsTextFrame.cpp:3726-3830), with text-justify auto and no preserved tabs: per justifiable cluster, a gap pair on each
// side, shared with a justifiable neighbour. `assignments` index transformed characters from nextT[rangeStart].
function computeJustification(p: GeckoPrepared, frame: number, rangeStart: number, rangeEnd: number): { info: Justification; assignments: Assignment[]; arrayStart: number } {
  const f = p.frames[frame]!
  const style = p.runStyles[f.run]!
  const lang = p.runLangs[f.run]!.toLowerCase()
  const cj = lang === 'ja' || lang === 'zh' || lang.startsWith('ja-') || lang.startsWith('zh-') // IsChineseOrJapanese, :3441-3454
  const arrayStart = Math.min(p.nextT[rangeStart]!, f.tEnd)
  const tEnd = Math.min(p.nextT[rangeEnd]!, f.tEnd)
  const assignments: Assignment[] = []
  for (let t = arrayStart; t < tEnd; t++) assignments.push({ start: 0, end: 0 })
  const info: Justification = { inner: 0, startJustifiable: false, endJustifiable: false }
  for (let s = rangeStart; s < rangeEnd; s++) {
    const t = p.sourceT[s]!
    if (t === -1) continue
    if (!isJustifiableCharacter(p, s, f.end, f.is8bit, style.whiteSpaceIsSignificant, cj)) continue
    // FindClusterStart and FindClusterEnd (:3549-3576): back to the cluster start, forward to its last character, stopping
    // at skipped characters.
    let first = t
    while (first > arrayStart && p.clusterStart[first] === 0 && p.tSource[first]! - 1 === p.tSource[first - 1]!) first--
    const firstChar = first - arrayStart
    if (firstChar === 0) {
      info.startJustifiable = true
    } else if (assignments[firstChar - 1]!.end !== 0) {
      assignments[firstChar - 1]!.end = 1
      assignments[firstChar]!.start = 1
    } else {
      assignments[firstChar]!.start = 2
      info.inner++
    }
    let last = t
    while (last + 1 < tEnd && p.clusterStart[last + 1] === 0 && p.tSource[last + 1]! - 1 === p.tSource[last]!) last++
    assignments[last - arrayStart]!.end = 2
    info.inner++
    s = p.tSource[last]!
  }
  if (assignments.length > 0 && assignments[assignments.length - 1]!.end !== 0) {
    info.inner--
    info.endJustifiable = true
  }
  return { info, assignments, arrayStart }
}

// nsTextFrame::ReflowText (nsTextFrame.cpp:10847-11532) into the current span.
function reflowText(p: GeckoPrepared, m: Measurer, ll: LineLayout, psd: SpanData, item: number, contentStart: number, gaps: LineGaps): FrameResult {
  const fi = (p.items[item] as { frame: number }).frame
  const f = p.frames[fi]!
  const run = p.textRuns[f.textRun]!
  const style = p.runStyles[f.run]!
  const maxContentLength = f.end - contentStart
  const empty = (offset: number): FrameResult => ({
    frame: fi, item, contentStart, offset, length: 0, charsFit: 0, contentLength: maxContentLength,
    tEnd: Math.min(p.nextT[contentStart + maxContentLength]!, f.tEnd), advance: 0, width: 0, nonEmpty: false,
    usedHyphenation: false, brokeText: false, trimmedTrailingWhitespace: false, trimmableChars: 0, hangableISize: 0,
    status: 'complete', incomplete: false, endsInNewline: false, prov: null, justification: NO_JUSTIFICATION, trimmableWS: null,
  })
  if (maxContentLength === 0) return empty(contentStart)
  const atStartOfLine = ll.lineAtStart
  let offset = contentStart
  let length = maxContentLength
  let newLineOffset = -1
  if (style.newlineIsSignificant) {
    const nl = p.text.indexOf('\n', offset)
    if (nl >= 0 && nl < offset + length) {
      newLineOffset = nl
      length = nl + 1 - offset
    }
  }
  if (atStartOfLine && !style.whiteSpaceIsSignificant) {
    const skipLength = newLineOffset >= 0 ? length - 1 : length
    let count = 0
    while (count < skipLength && isTrimmableChar(p.text, offset + count, f.end, f.is8bit)) count++
    offset += count
    length -= count
  }
  if (length === 0) return empty(offset)
  const tOffset = Math.min(p.nextT[offset]!, f.tEnd)
  let forceBreak = ll.force !== null && ll.force.item === item && ll.force.contentStart === contentStart ? ll.force.offset : -1
  let forceBreakAfter = false
  if (forceBreak >= length) {
    forceBreakAfter = forceBreak === length
    forceBreak = -1
  }
  const limitLength = forceBreak >= 0 ? forceBreak : length
  const tLength = Math.min(p.nextT[offset + limitLength]!, f.tEnd) - tOffset
  // availableSpaceOnLine (nsLineLayout.cpp:798).
  const availWidth = psd.iEnd - psd.iCoord - psd.inset
  const canTrim = !style.whiteSpaceIsSignificant
  const prov: Provider = {
    run, frame: fi, start: offset, length, startT: tOffset, startOfLine: atStartOfLine, letterSpacingAu: p.letterSpacingAu[f.run]!,
    tabs: new Map(),
  }
  // GetCurrentFrameInlineDistanceFromBlock less the block's padding, 0 here (nsTextFrame.cpp:11063-11067,
  // nsLineLayout.cpp:1154-1160): the sum of the span chain's inline coordinates.
  let xForTabs = 0
  for (let s: SpanData | null = psd; s !== null; s = s.parent) xForTabs += s.iCoord
  computeTabs(p, m, prov, tOffset + tLength, xForTabs, gaps)
  // LineIsBreakable: a placed frame or a band impacted by floats (nsLineLayout.h:151-155; nsTextFrame.cpp:11133-11135).
  const lineIsBreakable = ll.totalPlaced > 0 || ll.impactedByFloats
  const r = breakAndMeasureText(p, m, prov, tOffset, tLength, availWidth, lineIsBreakable ? 'none' : 'initial',
    style.wordCanWrap, style.wrap, style.isBreakSpaces, canTrim || style.whitespaceCanHang, ll.lastOptPriority, gaps)
  // An emergency break after a hyphen exists where SetupClusterBoundaries saw an alphanumeric, the hyphen and the next
  // alphanumeric in one shaped word (gfxFont.cpp:741-753), and InitScriptRun shapes words per font range
  // (gfxTextRun.cpp:2930-3000), so fallback between them removes it. Canvas totals don't show font ranges; the coverage
  // facts do, and only a break they couldn't settle is reported (prepare.ts step 4).
  if (r.charsFit < tLength && r.breakPriority === WORD_WRAP_BREAK && !style.wordCanWrap && p.breakFlags[tOffset + r.charsFit] === BREAK_EMERGENCY_WRAP &&
    p.emergencyUnconfirmed.has(tOffset + r.charsFit)) {
    gaps.list.push({ gap: 'font-fallback', run: f.run, detail: `offset ${p.tSource[tOffset + r.charsFit]}: the emergency break after a hyphen needs the hyphen and the letters around it in one font range, which Canvas can't show (gfxFont.cpp:741-753, gfxTextRun.cpp:2930-3000)` })
  }
  const originalOffset = (t: number): number => t < p.tSource.length ? p.tSource[t]! : p.text.length
  let charsFit = originalOffset(tOffset + r.charsFit) - offset
  if (offset + charsFit === newLineOffset) charsFit++
  let lastBreak = -1
  let usedHyphenation = r.usedHyphenation
  if (charsFit >= limitLength) {
    charsFit = limitLength
    if (r.lastBreak >= 0) lastBreak = originalOffset(tOffset + r.lastBreak)
    if ((forceBreak >= 0 || forceBreakAfter) && hasSoftHyphenBefore(p, offset, offset + charsFit)) usedHyphenation = true
  }
  let adv = r.advance
  if (usedHyphenation) adv += run.hyphenAu // AddHyphenToMetrics (nsTextFrame.cpp:6829-6845)
  const brokeText = forceBreak >= 0 || r.charsFit < tLength
  let trimmable = r.trimmableAdvance
  let trimmedTrailingWhitespace = false
  let hangableISize = 0
  let trimmableWS: FrameResult['trimmableWS'] = null
  if (trimmable > 0) {
    if (canTrim) {
      if (brokeText) {
        trimmedTrailingWhitespace = true
        adv -= trimmable
        trimmable = 0
      }
    } else if (style.whitespaceCanHang) {
      const hang = Math.min(Math.max(0, adv - availWidth), trimmable)
      hangableISize = trimmable - hang
      if (p.paragraph.textAlign === 'justify') trimmableWS = { advance: trimmable, count: r.trimmableChars }
      adv -= hang
      trimmable = 0
    }
  }
  if (!brokeText && lastBreak >= 0) notifyOptionalBreak(ll, { item, contentStart, offset: lastBreak - offset }, true, r.breakPriority)
  const contentLength = offset + charsFit - contentStart
  const width = Math.ceil(Math.max(0, adv))
  let nonEmpty = usedHyphenation
  if (r.charsFit > 0) {
    ll.trimmableISize = Math.floor(trimmable)
    nonEmpty = true
  }
  let breakAfter = forceBreakAfter
  if (charsFit > 0 && charsFit === length && hasSoftHyphenBefore(p, offset, offset + charsFit)) {
    notifyOptionalBreak(ll, { item, contentStart, offset: length }, adv + run.hyphenAu + prov.letterSpacingAu <= availWidth, NORMAL_BREAK)
  }
  if (!breakAfter && charsFit === length && tOffset + tLength === run.tEnd && run.trailingBreak) {
    if (adv - trimmable > availWidth) breakAfter = true
    else notifyOptionalBreak(ll, { item, contentStart, offset: length }, true, NORMAL_BREAK)
  }
  let status: FrameResult['status'] = 'complete'
  let endsInNewline = false
  if (charsFit === 0 && length > 0 && !usedHyphenation) status = 'break-before'
  else if (contentLength > 0 && contentStart + contentLength - 1 === newLineOffset) { status = 'break-after'; endsInNewline = true }
  else if (breakAfter) status = 'break-after'
  // Justification opportunities over [offset, offset + charsFit) when the block justifies (nsTextFrame.cpp:11513-11521).
  const justification = p.paragraph.textAlign === 'justify' ? computeJustification(p, fi, offset, offset + charsFit).info : NO_JUSTIFICATION
  return {
    frame: fi, item, contentStart, offset, length, charsFit, contentLength, tEnd: Math.min(p.nextT[contentStart + contentLength]!, f.tEnd),
    advance: adv, width, nonEmpty, usedHyphenation, brokeText, trimmedTrailingWhitespace, trimmableChars: r.trimmableChars,
    hangableISize, status, incomplete: contentLength !== maxContentLength, endsInNewline, prov, justification, trimmableWS,
  }
}

// HasSoftHyphenBefore (nsTextFrame.cpp:10514-10536), manual hyphens: walk back over skipped characters.
function hasSoftHyphenBefore(p: GeckoPrepared, start: number, end: number): boolean {
  for (let j = end - 1; j >= start; j--) {
    if (p.sourceT[j] !== -1) return false
    if (p.text.charCodeAt(j) === SHY) return true
  }
  return false
}

// Where the content after a frame starts: an item and a source offset.
type Position = { item: number; offset: number }

// nsReflowStatus as far as the line reads it: break-before (the frame is pushed), break-after, incomplete; with the position
// the rest of the content starts at.
type Status = { breakBefore: boolean; breakAfter: boolean; incomplete: boolean; next: Position }

const itemAt = (p: GeckoPrepared, k: number): number => k < p.items.length ? p.items[k]!.at : p.text.length
const completeAt = (p: GeckoPrepared, k: number): Status => ({ breakBefore: false, breakAfter: false, incomplete: false, next: { item: k, offset: itemAt(p, k) } })

type Pass = { kind: 'below-floats' } | { kind: 'line'; status: Status; ll: LineLayout; redo: boolean }

// The band a slot gives the line (nsBlockFrame::DoReflowInlineFrames, nsBlockFrame.cpp:5252-5273): the float available
// space's logical start and inline size, and whether floats narrow it. The slot insets are the float margin boxes' CSS px
// widths, ToAppUnits like any length.
type Band = { iStart: number; iSize: number; impactedByFloats: boolean; left: number; containerWidth: number }

function bandOf(p: GeckoPrepared, slot: LineSlot): Band {
  const containerWidth = pxToAu(p.paragraph.width)
  const left = pxToAu(slot.left)
  const right = pxToAu(slot.right)
  const rtl = p.paragraph.direction === 'rtl'
  return { iStart: rtl ? right : left, iSize: containerWidth - left - right, impactedByFloats: slot.left !== 0 || slot.right !== 0, left, containerWidth }
}

// nsBlockFrame::DoReflowInlineFrames (nsBlockFrame.cpp:5232-5476) with nsLineLayout::BeginLineReflow (nsLineLayout.cpp:107-221).
function reflowPass(p: GeckoPrepared, m: Measurer, start: GeckoLineStart, band: Band, force: BreakPosition | null, gaps: LineGaps): Pass {
  const root: SpanData = {
    element: -1, iStart: band.iStart, iCoord: band.iStart + (start.isFirstLine ? p.textIndentAu : 0), iEnd: band.iStart + band.iSize,
    inset: 0, noWrap: !p.blockStyle.wrap, frames: [], hasNonemptyContent: false, parent: null,
  }
  const ll: LineLayout = {
    root, lineIsEmpty: true, lineAtStart: true, totalPlaced: 0, trimmableISize: 0, needBackup: false, lastOpt: null,
    lastOptPriority: NO_BREAK, force, impactedByFloats: band.impactedByFloats, lineEndsInBR: false, lineWrapped: false,
  }
  // With floats in the band the line start is a soft break: the line can always move below them (nsBlockFrame.cpp:5289-5299).
  if (band.impactedByFloats && notifyOptionalBreak(ll, { item: start.frame, contentStart: start.contentOffset, offset: 0 }, true, NORMAL_BREAK)) {
    return { kind: 'below-floats' }
  }
  const status = reflowChildren(p, m, ll, root, start.frame, p.items.length, openSpansAt(p, start), 0, start, gaps)
  if (status === 'redo-next-band') return { kind: 'below-floats' }
  const redo = ll.needBackup && ll.force === null && ll.lastOpt !== null // nsBlockFrame.cpp:5361-5379
  return { kind: 'line', status, ll, redo }
}

// The spans a line start sits inside, outermost first: their continuations open the line without start edges.
function openSpansAt(p: GeckoPrepared, start: GeckoLineStart): number[] {
  if (start.frame >= p.items.length) return []
  const item = p.items[start.frame]!
  let parent: number
  switch (item.kind) {
    case 'text': parent = p.runParents[p.frames[item.frame]!.run]!; break
    case 'close': parent = item.element; break
    default: parent = p.elements[item.element]!.parent
  }
  const chain: number[] = []
  for (let e = parent; e >= 0; e = p.elements[e]!.parent) chain.push(e)
  return chain.reverse()
}

// Reflows the children of `psd` from item `from` until `end` (the span's close event, or the end for the root), mapping each
// child's status the way the container does: nsInlineFrame::ReflowInlineFrame for a span (nsInlineFrame.cpp:707-757,
// ReflowFrames :585-600) and nsBlockFrame::ReflowInlineFrame for the block (nsBlockFrame.cpp:5486-5620).
function reflowChildren(p: GeckoPrepared, m: Measurer, ll: LineLayout, psd: SpanData, from: number, end: number, chain: number[],
  depth: number, start: GeckoLineStart, gaps: LineGaps): Status | 'redo-next-band' {
  let k = from
  let first = true
  while (k < end) {
    let s: Status
    if (first && depth < chain.length) {
      s = reflowSpan(p, m, ll, psd, chain[depth]!, true, from, chain, depth + 1, start, gaps)
    } else {
      const item = p.items[k]!
      switch (item.kind) {
        case 'text': {
          const f = p.frames[item.frame]!
          s = reflowTextFrame(p, m, ll, psd, k, k === start.frame ? Math.max(start.contentOffset, f.start) : f.start, gaps)
          break
        }
        case 'open':
          s = reflowSpan(p, m, ll, psd, item.element, false, k + 1, chain, chain.length, start, gaps)
          break
        case 'atomic':
        case 'br':
        case 'wbr':
          s = reflowLeaf(p, ll, psd, k)
          break
        case 'close':
          throw new Error(`gecko: close event ${k} outside its span`)
      }
    }
    if (psd.element >= 0) {
      if (s.breakBefore) {
        // Break-before on a child other than the first becomes break-after and incomplete; on the first, it propagates.
        return first ? s : { breakBefore: false, breakAfter: true, incomplete: true, next: s.next }
      }
      if (s.breakAfter) return s.next.item < end ? { ...s, incomplete: true } : s
      if (s.incomplete) return s
    } else {
      if (s.breakBefore) {
        // Break-before on the line's first frame: the line moves below the floats (RedoNextBand); otherwise the line is
        // split before the pushed frame and marked wrapped.
        if (first) {
          if (!ll.impactedByFloats) throw new Error(`gecko: the first frame of a line without floats broke before at item ${k}`)
          return 'redo-next-band'
        }
        ll.lineWrapped = true
        return s
      }
      if (s.incomplete && !ll.lineEndsInBR) ll.lineWrapped = true
      if (s.breakAfter || s.incomplete) return s
    }
    k = s.next.item
    first = false
  }
  return completeAt(p, end)
}

// nsLineLayout::ReflowFrame for a text frame (nsLineLayout.cpp:733-1092) and its CanPlaceFrame branch (:1189-1342).
function reflowTextFrame(p: GeckoPrepared, m: Measurer, ll: LineLayout, psd: SpanData, k: number, contentStart: number, gaps: LineGaps): Status {
  const notSafeToBreak = ll.lineIsEmpty && !ll.impactedByFloats // :785
  const iStart = psd.iCoord
  const r = reflowText(p, m, ll, psd, k, contentStart, gaps)
  if (r.status === 'break-before') return { breakBefore: true, breakAfter: false, incomplete: false, next: { item: k, offset: contentStart } }
  // A text frame can continue a text run, so it is always placed, and an overflow requests backup (:1323-1335).
  if (!psd.noWrap && iStart + r.width - ll.trimmableISize > psd.iEnd && r.width !== 0 && !notSafeToBreak) ll.needBackup = true
  if (r.nonEmpty) {
    psd.hasNonemptyContent = true
    ll.lineIsEmpty = false
    ll.lineAtStart = false
  }
  psd.frames.push({
    kind: 'text', item: k, r, iStart, iSize: r.width, trimDelta: 0, trimmedEnd: r.contentStart + r.contentLength, endOfLine: false,
    justification: { ...r.justification }, assign: { start: 0, end: 0 },
  })
  psd.iCoord = iStart + r.width
  ll.totalPlaced++
  const next = r.incomplete ? { item: k, offset: r.contentStart + r.contentLength } : { item: k + 1, offset: itemAt(p, k + 1) }
  return { breakBefore: false, breakAfter: r.status === 'break-after', incomplete: r.incomplete, next }
}

// An inline element: nsLineLayout::ReflowFrame (nsLineLayout.cpp:733-1092) into nsInlineFrame::ReflowFrames
// (nsInlineFrame.cpp:489-688) with BeginSpan and EndSpan (nsLineLayout.cpp:378-436), then CanPlaceFrame and PlaceFrame for the
// span frame. `continuation`: the span's frame on this line continues one from an earlier line.
function reflowSpan(p: GeckoPrepared, m: Measurer, ll: LineLayout, parent: SpanData, element: number, continuation: boolean,
  childFrom: number, chain: number[], depth: number, start: GeckoLineStart, gaps: LineGaps): Status {
  const el = p.elements[element] as Extract<GeckoElement, { kind: 'span' }>
  const notSafeToBreak = ll.lineIsEmpty && !ll.impactedByFloats
  const iStart = parent.iCoord
  const availableSpaceOnLine = parent.iEnd - parent.iCoord - parent.inset
  // The frame's open item, and whether it begins a bidi continuation (GetPrevContinuation is then set).
  const openItem = continuation ? -1 : childFrom - 1
  const split = !continuation && (p.items[openItem] as Extract<GeckoPrepared['items'][number], { kind: 'open' | 'close' }>).split
  // Its children end at this continuation's close item; only the element's own close ends the last continuation.
  let end = el.close
  for (let c = 0; c < el.closes.length; c++) if (el.closes[c]! >= childFrom) { end = el.closes[c]!; break }
  const finalClose = end === el.close
  // AllowForStartMargin: only the first continuation keeps its start margin (nsLineLayout.cpp:1110-1134).
  const startMargin = continuation || split ? 0 : el.edges.startMargin
  // The start border and padding only without a previous continuation; the end border and padding off every line
  // (nsInlineFrame.cpp:500-521).
  const startEdge = continuation || split ? 0 : el.edges.startBorderPadding
  const availableISize = availableSpaceOnLine - startMargin - startEdge - el.edges.endBorderPadding
  const span: SpanData = {
    element, iStart: startEdge, iCoord: startEdge, iEnd: startEdge + availableISize, inset: 0, noWrap: !el.style.wrap, frames: [],
    hasNonemptyContent: false, parent,
  }
  const s = reflowChildren(p, m, ll, span, childFrom, end, chain, depth, start, gaps)
  if (s === 'redo-next-band') throw new Error('gecko: redo-next-band inside a span')
  if (s.breakBefore) {
    // The span frame itself is pushed (nsLineLayout.cpp:1081-1084, nsInlineFrame.cpp:717-731).
    return { ...s, next: continuation ? s.next : { item: openItem, offset: itemAt(p, openItem) } }
  }
  const complete = !s.incomplete
  // The end edge and margin only when complete without a bidi continuation after (nsInlineFrame.cpp:670-674,
  // nsLineLayout.cpp:1217-1224).
  const last = complete && finalClose
  // EndSpan's width, 0 without placed frames (nsLineLayout.cpp:431), plus the edges ReflowFrames adds (nsInlineFrame.cpp:643-674).
  const iSize = (span.frames.length > 0 ? span.iCoord - span.iStart : 0) + startEdge + (last ? el.edges.endBorderPadding : 0)
  // CanPlaceFrame: the end margin only on the last continuation (:1217-1224), the start margin moves the frame (:1227-1230). A
  // span can continue a text run, so it is placed whatever the fit, requesting backup on overflow (:1323-1335).
  const endMargin = last ? el.edges.endMargin : 0
  const placedStart = iStart + startMargin
  if (!parent.noWrap && placedStart + iSize - ll.trimmableISize + endMargin > parent.iEnd && startMargin + iSize + endMargin !== 0 && !notSafeToBreak) {
    ll.needBackup = true
  }
  // nsInlineFrame::IsEmpty over the placed children (:908-930).
  if (span.hasNonemptyContent || !el.selfEmpty) {
    parent.hasNonemptyContent = true
    ll.lineIsEmpty = false
  }
  parent.frames.push({
    kind: 'span', item: continuation ? childFrom : openItem, element, span, iStart: placedStart, iSize, startMargin, endMargin,
    hasStartEdge: !(continuation || split), hasEndEdge: last, innerOpportunities: 0, hasPrevContinuation: continuation || split,
    hasNextContinuation: !last,
  })
  parent.iCoord = placedStart + iSize + endMargin
  ll.totalPlaced++
  return complete ? { ...s, next: { item: end + 1, offset: itemAt(p, end + 1) } } : s
}

// nsLineLayout::ReflowFrame for an atomic inline, <br> or <wbr> (nsLineLayout.cpp:733-1092): BRFrame::Reflow ends the line
// after itself (BRFrame.cpp:98-166); a WBRFrame reflows to 0 × 0 and isn't empty (nsIFrame::IsEmpty, nsIFrame.cpp:9380-9382).
// None continues a text run, so each clears the trimmable width (except the BR, skipped when trimming, :1015-1020), may be
// pushed when it overflows (CanPlaceFrame :1189-1342), and records a break after itself (:1057-1071).
function reflowLeaf(p: GeckoPrepared, ll: LineLayout, psd: SpanData, k: number): Status {
  const item = p.items[k] as Extract<GeckoPrepared['items'][number], { kind: 'atomic' | 'br' | 'wbr' }>
  const el = p.elements[item.element]!
  const notSafeToBreak = ll.lineIsEmpty && !ll.impactedByFloats
  const iStart = psd.iCoord
  const iSize = el.kind === 'atomic' ? el.iSize : 0
  const startMargin = el.kind === 'atomic' ? el.startMargin : 0
  const endMargin = el.kind === 'atomic' ? el.endMargin : 0
  let breakAfter = false
  if (item.kind === 'br') {
    breakAfter = true
    ll.lineEndsInBR = true
  }
  const savedOpt = ll.lastOpt
  const savedPriority = ll.lastOptPriority
  if (item.kind !== 'br') ll.trimmableISize = 0
  let optionalBreakAfterFits = true
  if (!psd.noWrap) {
    const outside = iStart + startMargin + iSize - ll.trimmableISize + endMargin > psd.iEnd
    if (outside) {
      optionalBreakAfterFits = false
      if (startMargin + iSize + endMargin !== 0 && item.kind !== 'br' && !notSafeToBreak) {
        // SetInlineLineBreakBeforeAndReset, PushFrame and RestoreSavedBreakPosition (:1340-1341, :1072-1079).
        ll.lastOpt = savedOpt
        ll.lastOptPriority = savedPriority
        return { breakBefore: true, breakAfter: false, incomplete: false, next: { item: k, offset: item.at } }
      }
    }
  }
  psd.hasNonemptyContent = true
  ll.lineIsEmpty = false
  ll.lineAtStart = false
  psd.frames.push({ kind: item.kind, item: k, element: item.element, iStart: iStart + startMargin, iSize, startMargin, endMargin, assign: { start: 0, end: 0 } })
  psd.iCoord = iStart + startMargin + iSize + endMargin
  ll.totalPlaced++
  if (!psd.noWrap && !ll.lineIsEmpty) {
    if (notifyOptionalBreak(ll, { item: k, contentStart: item.at, offset: AFTER_CONTENT }, optionalBreakAfterFits, NORMAL_BREAK)) breakAfter = true
  }
  return { breakBefore: false, breakAfter, incomplete: false, next: { item: k + 1, offset: itemAt(p, k + 1) } }
}

// nsBlockFrame::ReflowInlineFrames (nsBlockFrame.cpp:5123-5199): one redo with the saved break forced.
function reflowLine(p: GeckoPrepared, m: Measurer, start: GeckoLineStart, band: Band, gaps: LineGaps): Pass {
  const pass = reflowPass(p, m, start, band, null, gaps)
  if (pass.kind === 'below-floats' || !pass.redo) return pass
  return reflowPass(p, m, start, band, pass.ll.lastOpt, gaps)
}

// A block with frames has at least one line; a paragraph whose text nodes all lack frames and has no elements has none.
export function firstGeckoLine(p: GeckoPrepared): GeckoLineStart | null {
  return p.items.length === 0 ? null : { engine: 'gecko', frame: 0, contentOffset: 0, isFirstLine: true }
}

export function nextGeckoLine(p: GeckoPrepared, start: GeckoLineStart, slot: LineSlot, m: Measurer): GeckoLineResult {
  const band = bandOf(p, slot)
  const gaps: LineGaps = { list: [], inWord: new Map() }
  const pass = reflowLine(p, m, start, band, gaps)
  if (pass.kind === 'below-floats') return { kind: 'below-floats', gaps: gaps.list }
  const next = pass.status.next
  if (next.item < start.frame || (next.item === start.frame && next.offset <= start.contentOffset)) {
    throw new Error(`gecko: no progress at item ${start.frame}, offset ${start.contentOffset}`)
  }
  // Characters after the last item belong to text nodes without frames, which the last line holds as collapsed.
  const more = next.item < p.items.length
  const end = more ? next.offset : p.text.length
  const nextStart: GeckoLineStart | null = more ? { engine: 'gecko', frame: next.item, contentOffset: next.offset, isFirstLine: start.isFirstLine && pass.ll.lineIsEmpty } : null
  return { kind: 'line', line: lineOutput(p, m, start, end, next, pass.ll, band, slot, gaps, nextStart) }
}

// Per source unit from the frame's measured start: what GetAdvanceWidth adds for it (gfxTextRun.cpp:1214-1256,
// nsTextFrame.cpp:4089-4295): a cluster's glyph advance on its first character, the spacing after a character on that
// character, a tab's width on the tab. Skipped characters add nothing.
function characters(p: GeckoPrepared, m: Measurer, r: FrameResult, prov: Provider, justification: Map<number, number> | null): { characters: GeckoCharacter[]; standInAtEnd: boolean } {
  const out: GeckoCharacter[] = []
  let before = advanceBefore(p, m, prov.run, prov.startT)
  for (let s = r.offset; s < r.contentStart + r.contentLength; s++) {
    const t = p.sourceT[s]!
    if (t === -1) {
      out.push({ skipped: true, clusterStart: false, unitStart: false, advance: 0, standInBefore: false })
      continue
    }
    const after = advanceBefore(p, m, prov.run, t + 1)
    out.push({
      skipped: false, clusterStart: p.clusterStart[t] === 1, unitStart: p.units[p.unitOf[t]!]!.tStart === t,
      advance: after.au - before.au + p.spacingPrefix[t + 1]! - p.spacingPrefix[t]! + (prov.tabs.get(t) ?? 0) + (justification?.get(t) ?? 0),
      standInBefore: before.standIn !== null,
    })
    before = after
  }
  return { characters: out, standInAtEnd: before.standIn !== null }
}

// The frames' visual order: UAX #9 L2 over their levels, as nsBidiPresUtils::ReorderFrames orders a line
// (nsBidiPresUtils.cpp:1494-1533, Bidi::ReorderVisual through unicode-bidi).
function visualOrder(levels: number[]): number[] {
  const order: number[] = []
  let maxLevel = 0
  let minLevel = 255
  for (let k = 0; k < levels.length; k++) {
    order.push(k)
    maxLevel = Math.max(maxLevel, levels[k]!)
    minLevel = Math.min(minLevel, levels[k]!)
  }
  const lowestOdd = (minLevel & 1) === 1 ? minLevel : minLevel + 1
  for (let level = maxLevel; level >= lowestOdd; level--) {
    for (let i = 0; i < order.length;) {
      if (levels[order[i]!]! < level) { i++; continue }
      let j = i
      while (j < order.length && levels[order[j]!]! >= level) j++
      const reversed = order.slice(i, j).reverse()
      for (let q = 0; q < reversed.length; q++) order[i + q] = reversed[q]!
      i = j
    }
  }
  return order
}

// nsLineLayout::TrimTrailingWhiteSpaceIn (nsLineLayout.cpp:2851-2985) over one span: from the last frame back, a child span
// is searched first, a frame that isn't text and isn't skipped when trimming (anything but a <br>) ends the search, and a
// text frame not already trimmed at its break loses the floored advance of its trailing IsTrimmableSpace characters,
// unclamped (nsTextFrame.cpp:11540-11628). Frames after a trimmed one slide back.
function trimTrailingWhiteSpaceIn(p: GeckoPrepared, m: Measurer, psd: SpanData): { handled: boolean; delta: number } {
  for (let k = psd.frames.length - 1; k >= 0; k--) {
    const pf = psd.frames[k]!
    let delta = 0
    let handled = false
    if (pf.kind === 'span') {
      const inner = trimTrailingWhiteSpaceIn(p, m, pf.span)
      if (!inner.handled) continue
      delta = inner.delta
      handled = true
    } else if (pf.kind !== 'text') {
      if (pf.kind === 'br') continue
      return { handled: true, delta: 0 }
    } else {
      const r = pf.r
      const f = p.frames[r.frame]!
      const contentEnd = r.contentStart + r.contentLength
      pf.endOfLine = true
      let changed = false
      if (!p.runStyles[f.run]!.whiteSpaceIsSignificant && !r.trimmedTrailingWhitespace && r.prov !== null) {
        let end = contentEnd
        while (end > r.offset && isTrimmableChar(p.text, end - 1, f.end, f.is8bit)) end--
        pf.trimmedEnd = end
        const tA = Math.min(p.nextT[end]!, f.tEnd)
        const tB = Math.min(p.nextT[contentEnd]!, f.tEnd)
        if (tA < tB) {
          delta = Math.floor(advanceWidth(p, m, r.prov, tA, tB, null))
          pf.trimDelta = delta
          changed = true
        }
      }
      handled = r.nonEmpty || changed
    }
    if (delta !== 0) {
      if (pf.kind === 'text') {
        // JustificationInfo::CancelOpportunityForTrimmedSpace (JustificationUtils.h).
        if (pf.justification.inner > 0) pf.justification.inner--
        else pf.justification = { ...pf.justification, startJustifiable: false, endJustifiable: false }
      }
      pf.iSize -= delta
      psd.iCoord -= delta
      for (let j = k + 1; j < psd.frames.length; j++) psd.frames[j]!.iStart -= delta
    }
    if (handled) return { handled: true, delta }
  }
  return { handled: false, delta: 0 }
}

// nsLineLayout::GetTrimFrom (nsLineLayout.cpp:3452-3478): the last text frame's TrimmableWS, its advance negated when its
// text run's direction is against the line's.
function trimFrom(p: GeckoPrepared, psd: SpanData, lineIsRtl: boolean): { advance: number; count: number } {
  for (let k = psd.frames.length - 1; k >= 0; k--) {
    const pf = psd.frames[k]!
    if (pf.kind === 'span') return trimFrom(p, pf.span, lineIsRtl)
    if (pf.kind === 'text') {
      const ws = pf.r.trimmableWS
      if (ws === null) return { advance: 0, count: 0 }
      return { advance: ((p.frames[pf.r.frame]!.level & 1) === 1) !== lineIsRtl ? -ws.advance : ws.advance, count: ws.count }
    }
    if (pf.kind !== 'br') return { advance: 0, count: 0 }
  }
  return { advance: 0, count: 0 }
}

// nsLineLayout::GetHangFrom (nsLineLayout.cpp:3416-3450): the hangable white space of the line's last text frame, negated
// when its text run's direction is against the line's; frames skipped when trimming (<br>) are passed over.
function hangFrom(p: GeckoPrepared, psd: SpanData, lineIsRtl: boolean): number {
  for (let k = psd.frames.length - 1; k >= 0; k--) {
    const pf = psd.frames[k]!
    if (pf.kind === 'span') return hangFrom(p, pf.span, lineIsRtl)
    if (pf.kind === 'text') {
      const result = pf.r.hangableISize
      if (result === 0) return 0
      return ((p.frames[pf.r.frame]!.level & 1) === 1) !== lineIsRtl ? -result : result
    }
    if (pf.kind !== 'br') return 0
  }
  return 0
}

// nsLineLayout::PerFrameData::ParticipatesInJustification (nsLineLayout.cpp:2993-3004): not empty, not skipped when trimming
// (<br>), and not a white-space-only text node's frame at the end of the line.
function participatesInJustification(p: GeckoPrepared, pf: Placed): boolean {
  switch (pf.kind) {
    case 'br': return false
    case 'span': return pf.span.hasNonemptyContent || !(p.elements[pf.element] as Extract<GeckoElement, { kind: 'span' }>).selfEmpty
    case 'atomic': case 'wbr': return true
    case 'text': {
      if (!pf.r.nonEmpty) return false
      if (!pf.endOfLine) return true
      // TextIsOnlyWhitespace of the node (CharacterData.cpp:486-510).
      const run = p.frames[pf.r.frame]!.run
      for (let s = p.runStarts[run]!; s < p.runStarts[run + 1]!; s++) {
        const u = p.text.charCodeAt(s)
        if (u !== 0x20 && u !== 0x09 && u !== 0x0a && u !== 0x0d) return true
      }
      return false
    }
  }
}

type ComputationState = { last: PlacedText | PlacedLeaf | null }
const justificationOf = (pf: PlacedText | PlacedLeaf): Justification => pf.kind === 'text' ? pf.justification : NO_JUSTIFICATION

// nsLineLayout::AssignInterframeJustificationGaps (nsLineLayout.cpp:3031-3080), without ruby.
function assignInterframeGaps(pf: PlacedText | PlacedLeaf, state: ComputationState): number {
  const prev = state.last!
  const info = justificationOf(pf)
  const prevInfo = justificationOf(prev)
  if (!info.startJustifiable && !prevInfo.endJustifiable) return 0
  if (!info.startJustifiable) {
    prev.assign.end = 2
    pf.assign.start = 0
  } else if (!prevInfo.endJustifiable) {
    prev.assign.end = 0
    pf.assign.start = 2
  } else {
    prev.assign.end = 1
    pf.assign.start = 1
  }
  return 1
}

// nsLineLayout::ComputeFrameJustification (nsLineLayout.cpp:3084-3150): the span's inner opportunities into `inner`, and
// the opportunities before its first participant returned.
function computeFrameJustification(p: GeckoPrepared, psd: SpanData, state: ComputationState, inner: { count: number }): number {
  let firstChild = true
  let outer = 0
  for (let k = 0; k < psd.frames.length; k++) {
    const pf = psd.frames[k]!
    if (!participatesInJustification(p, pf)) continue
    let extra = 0
    if (pf.kind === 'span') {
      const spanInner = { count: 0 }
      extra = computeFrameJustification(p, pf.span, state, spanInner)
      pf.innerOpportunities = spanInner.count
      inner.count += spanInner.count
    } else {
      if (pf.kind === 'text') inner.count += pf.justification.inner
      if (state.last !== null) extra = assignInterframeGaps(pf, state)
      state.last = pf
    }
    if (firstChild) {
      outer = extra
      firstChild = false
    } else {
      inner.count += extra
    }
  }
  return outer
}

// JustificationApplicationState (JustificationUtils.h).
type ApplicationState = { count: number; handled: number; available: number; consumed: number }
function consume(state: ApplicationState, gaps: number): number {
  state.handled += gaps
  const allocated = Math.trunc((state.available * state.handled) / state.count)
  const delta = allocated - state.consumed
  state.consumed = allocated
  return delta
}

// nsLineLayout::ApplyFrameJustification (nsLineLayout.cpp:3220-3275), without annotations: each participant takes its gaps'
// share of the remaining width, frames after it move, and a leaf that isn't text takes its gaps as margins.
function applyFrameJustification(p: GeckoPrepared, psd: SpanData, state: ApplicationState): number {
  let deltaICoord = 0
  const justifiable = state.count > 0 && state.available > 0
  for (let k = 0; k < psd.frames.length; k++) {
    const pf = psd.frames[k]!
    let dw = 0
    if (participatesInJustification(p, pf)) {
      if (pf.kind === 'text') {
        if (justifiable) dw = consume(state, pf.justification.inner * 2 + pf.assign.start + pf.assign.end)
        else pf.assign = { start: 0, end: 0 }
      } else if (pf.kind === 'span') {
        dw = applyFrameJustification(p, pf.span, state)
      }
    }
    pf.iSize += dw
    let gapsAtEnd = 0
    if (pf.kind !== 'text' && pf.kind !== 'span' && pf.assign.start + pf.assign.end > 0) {
      deltaICoord += consume(state, pf.assign.start)
      gapsAtEnd = consume(state, pf.assign.end)
      dw += gapsAtEnd
    }
    pf.iStart += deltaICoord
    deltaICoord += dw
  }
  return deltaICoord
}

// PropertyProvider::SetupJustificationSpacing after reflow (nsTextFrame.cpp:4503-4560): the frame's extra width over its
// natural width, spread over its justifiable characters' gaps, keyed by transformed index.
function justificationSpacing(p: GeckoPrepared, m: Measurer, pf: PlacedText): Map<number, number> | null {
  const r = pf.r
  if (p.paragraph.textAlign !== 'justify' || r.prov === null) return null
  const f = p.frames[r.frame]!
  const style = p.runStyles[f.run]!
  // GetTrimmedOffsets with default flags: the end is trimmed on a frame at the end of the line (:3287-3330).
  let end = r.contentStart + r.contentLength
  if (!style.whiteSpaceIsSignificant && pf.endOfLine) while (end > r.offset && isTrimmableChar(p.text, end - 1, f.end, f.is8bit)) end--
  const { info, assignments, arrayStart } = computeJustification(p, r.frame, r.offset, end)
  const totalGaps = info.inner * 2 + pf.assign.start + pf.assign.end
  if (totalGaps === 0 || assignments.length === 0) return null
  let natural = advanceWidth(p, m, r.prov, Math.min(p.nextT[r.offset]!, f.tEnd), Math.min(p.nextT[end]!, f.tEnd), null)
  if (r.usedHyphenation) natural += p.textRuns[f.textRun]!.hyphenAu + r.prov.letterSpacingAu // GetHyphenWidth (:4388-4399)
  const totalSpacing = pf.iSize - natural
  if (totalSpacing <= 0) return null
  assignments[0]!.start = pf.assign.start
  assignments[assignments.length - 1]!.end = pf.assign.end
  const state: ApplicationState = { count: totalGaps, handled: 0, available: totalSpacing, consumed: 0 }
  const out = new Map<number, number>()
  for (let i = 0; i < assignments.length; i++) {
    const before = consume(state, assignments[i]!.start)
    const after = consume(state, assignments[i]!.end)
    if (before + after !== 0) out.set(arrayStart + i, before + after)
  }
  return out
}

// The line as Gecko places it: TrimTrailingWhiteSpaceIn, TextAlignLine and ReorderFrames give the frames' boxes and
// positions; the frames' flags classify the fragments.
function lineOutput(p: GeckoPrepared, m: Measurer, start: GeckoLineStart, lineEnd: number, next: Position, ll: LineLayout, band: Band,
  slot: LineSlot, gaps: LineGaps, nextStart: GeckoLineStart | null): GeckoLine {
  const root = ll.root
  trimTrailingWhiteSpaceIn(p, m, root)
  const rtl = p.paragraph.direction === 'rtl'
  const indented = start.isFirstLine && p.textIndentAu !== 0

  // TextAlignLine (nsLineLayout.cpp:3482-3670): the remaining inline size and, on a wrapped line, the hang.
  const availISize = root.iEnd - root.iStart
  const lineISize = root.iCoord - root.iStart
  const remaining = availISize - lineISize
  // TextAlignForLastLine: text-align-last auto gives the last line and a line ending in <br> start under justify
  // (nsBlockFrame.cpp:5966-5976). On a wrapped line justify reads GetTrimFrom's white space, other alignments the hang
  // (:3505-3516).
  const align: TextAlign = p.paragraph.textAlign === 'justify' && (ll.lineEndsInBR || nextStart === null) ? 'start' : p.paragraph.textAlign
  let hang = 0
  let trimCount = 0
  if (ll.lineWrapped) {
    if (align === 'justify') {
      const trim = trimFrom(p, root, rtl)
      hang = trim.advance
      trimCount = trim.count
    } else {
      hang = hangFrom(p, root, rtl)
    }
  }
  let dx = 0
  let expansion = 0
  if (remaining > 0 || hang !== 0) {
    switch (align) {
      case 'justify': {
        const inner = { count: 0 }
        computeFrameJustification(p, root, { last: null }, inner)
        const opportunities = inner.count - (hang !== 0 ? trimCount : 0)
        if (opportunities > 0) {
          const available = remaining + Math.abs(hang)
          expansion = applyFrameJustification(p, root, { count: opportunities * 2, handled: 0, available, consumed: 0 })
          if (hang < 0) dx = hang - Math.trunc((trimCount * available) / opportunities)
          break
        }
        if (hang < 0) dx = hang
        break
      }
      case 'start': if (hang < 0) dx = hang; break
      case 'left': dx = rtl ? remaining + Math.max(hang, 0) : hang < 0 ? hang : 0; break
      case 'right': dx = !rtl ? remaining + Math.max(hang, 0) : hang < 0 ? hang : 0; break
      case 'end': dx = remaining + Math.max(hang, 0); break
      case 'center': dx = Math.trunc((remaining + hang) / 2); break
    }
  }

  // Positions. Without bidi, frames keep their logical places plus dx (:3654-3668). With bidi, ReorderFrames repositions the
  // line's frames from psd->mIStart + mTextIndent + dx (:3646-3652; nsBidiPresUtils.cpp:1494-1533). x is the physical left edge
  // from the content box.
  const frames: GeckoFrameGeometry[] = []
  const placedText: PlacedText[] = []
  const geometryOf = new Map<Placed, GeckoFrameGeometry>()
  // Each span's frames on this line in logical order: the part of its continuation chain IsFirstOrLast counts.
  const spansOf = new Map<number, PlacedSpan[]>()
  const collect = (psd: SpanData, origin: number): void => {
    for (let k = 0; k < psd.frames.length; k++) {
      const pf = psd.frames[k]!
      const logical = origin + pf.iStart
      switch (pf.kind) {
        case 'text': {
          const r = pf.r
          const f = p.frames[r.frame]!
          placedText.push(pf)
          const geometry: GeckoFrameGeometry = {
            kind: 'text', run: f.run, contentStart: r.contentStart, contentEnd: r.contentStart + r.contentLength, measuredStart: r.offset,
            level: f.level, x: logical, width: pf.iSize, hasHeight: r.nonEmpty, usedHyphen: r.usedHyphenation,
            ...(r.prov === null ? { characters: [], standInAtEnd: false } : characters(p, m, r, r.prov, justificationSpacing(p, m, pf))),
            advancesStandIn: r.prov === null ? null : r.prov.run.advancesStandIn,
          }
          frames.push(geometry)
          geometryOf.set(pf, geometry)
          break
        }
        case 'span': {
          const geometry: Extract<GeckoFrameGeometry, { kind: 'inline' }> = { kind: 'inline', element: pf.element, x: logical, width: pf.iSize, hasStartEdge: pf.hasStartEdge, hasEndEdge: pf.hasEndEdge }
          frames.push(geometry)
          geometryOf.set(pf, geometry)
          const list = spansOf.get(pf.element)
          if (list === undefined) spansOf.set(pf.element, [pf])
          else list.push(pf)
          collect(pf.span, logical)
          break
        }
        case 'atomic': {
          const level = (p.elements[pf.element] as Extract<GeckoElement, { kind: 'atomic' }>).level
          const geometry: GeckoFrameGeometry = { kind: 'atomic', element: pf.element, level, x: logical, width: pf.iSize }
          frames.push(geometry)
          geometryOf.set(pf, geometry)
          break
        }
        case 'br': {
          const geometry: GeckoFrameGeometry = { kind: 'br', element: pf.element, x: logical, width: 0 }
          frames.push(geometry)
          geometryOf.set(pf, geometry)
          break
        }
        case 'wbr': {
          // A WBRFrame is 0 × 0 where it was placed; Firefox reports that box through getClientRects (feature family rows,
          // round 1: `c-00370d538345f01b` reports x 3558 au, width 0, height 0 after a 3558 au frame).
          const level = (p.elements[pf.element] as Extract<GeckoElement, { kind: 'br' | 'wbr' }>).level
          const geometry: GeckoFrameGeometry = { kind: 'wbr', element: pf.element, level, x: logical, width: 0 }
          frames.push(geometry)
          geometryOf.set(pf, geometry)
          break
        }
      }
    }
  }
  collect(root, 0)
  if (!p.bidi) {
    for (let k = 0; k < frames.length; k++) frames[k]!.x += dx
  } else {
    // BidiLineData orders the line's frames by the levels of their first leaves (GetFrameBidiData, nsBidiPresUtils.cpp:1545-1547),
    // and RepositionInlineFrames walks that order from the line's start edge (:1882-1905). RepositionFrame (:1769-1868) gives a
    // span its edges and margins by visual order (IsFirstOrLast :1561-1671) and walks its children left to right at an even
    // level and right to left at an odd one; a frame's start margin comes first in its container's walk. Every container
    // takes the block's direction. Places come out relative to the containing frame, then add up.
    const paragraphLevel = rtl ? 1 : 0
    const levelOf = (pf: Placed): number => {
      switch (pf.kind) {
        case 'text': return p.frames[pf.r.frame]!.level
        case 'span': return pf.span.frames.length > 0 ? levelOf(pf.span.frames[0]!) : paragraphLevel
        default: return (p.elements[pf.element] as Extract<GeckoElement, { kind: 'atomic' | 'br' | 'wbr' }>).level
      }
    }
    const relative = new Map<Placed, number>()
    const remaining = new Map<number, number>()
    spansOf.forEach((list, element) => remaining.set(element, list.length))
    const place = (pf: Placed, isEven: boolean, startOrEnd: number, containerReverse: boolean, containerWidth: number): number => {
      let icoord = pf.iSize
      let marginStart = pf.kind === 'atomic' ? pf.startMargin : 0
      let marginEnd = pf.kind === 'atomic' ? pf.endMargin : 0
      if (pf.kind === 'span') {
        const el = p.elements[pf.element] as Extract<GeckoElement, { kind: 'span' }>
        const list = spansOf.get(pf.element)!
        const left = remaining.get(pf.element)!
        remaining.set(pf.element, left - 1)
        const isFirst = left === list.length && !list[0]!.hasPrevContinuation
        const isLast = left === 1 && !list[list.length - 1]!.hasNextContinuation
        const startBP = isFirst ? el.edges.startBorderPadding : 0
        const endBP = isLast ? el.edges.endBorderPadding : 0
        marginStart = isFirst ? el.edges.startMargin : 0
        marginEnd = isLast ? el.edges.endMargin : 0
        // The reflowed size less the edges applied in continuation order, plus the visual ones (:1806-1826).
        const width = pf.iSize - (pf.hasStartEdge ? el.edges.startBorderPadding : 0) - (pf.hasEndEdge ? el.edges.endBorderPadding : 0) + startBP + endBP
        const reverseDir = isEven === rtl
        icoord = reverseDir ? endBP : startBP
        for (let k = 0; k < pf.span.frames.length; k++) icoord += place(pf.span.frames[k]!, isEven, icoord, reverseDir, width)
        icoord += reverseDir ? startBP : endBP
        const geometry = geometryOf.get(pf) as Extract<GeckoFrameGeometry, { kind: 'inline' }>
        geometry.width = icoord
        geometry.hasStartEdge = isFirst
        geometry.hasEndEdge = isLast
      }
      const frameStartOrEnd = startOrEnd + (containerReverse ? marginEnd : marginStart)
      const iStartInContainer = containerReverse ? containerWidth - frameStartOrEnd - icoord : frameStartOrEnd
      relative.set(pf, rtl ? containerWidth - iStartInContainer - icoord : iStartInContainer)
      return icoord + marginStart + marginEnd
    }
    const levels = root.frames.map(levelOf)
    const order = visualOrder(levels)
    let acc = root.iStart + (indented ? p.textIndentAu : 0) + dx
    for (let v = 0; v < order.length; v++) {
      const index = rtl ? order[order.length - 1 - v]! : order[v]!
      acc += place(root.frames[index]!, (levels[index]! & 1) === 0, acc, false, band.containerWidth)
    }
    const settle = (psd: SpanData, origin: number): void => {
      for (let k = 0; k < psd.frames.length; k++) {
        const pf = psd.frames[k]!
        const x = origin + relative.get(pf)!
        const geometry = geometryOf.get(pf)
        if (geometry !== undefined) geometry.x = x
        if (pf.kind === 'span') settle(pf.span, x)
      }
    }
    settle(root, 0)
  }

  // The white space the line end removed or hangs, by the frames' flags: trailing CharIsSpace characters trimmed at the
  // break (TEXT_TRIMMED_TRAILING_WHITESPACE, nsTextFrame.cpp:11203-11213; CharIsSpace is U+0020 and U+3000,
  // gfxFont.cpp:749-750), the IsTrimmableSpace characters TrimTrailingWhiteSpace removed, and under pre-wrap the trailing
  // CharIsSpace characters of the line's last frames with content (:11214-11229).
  const trimmed = new Set<number>()
  const hanging = new Set<number>()
  const placedByItem = new Map<number, PlacedText>()
  for (let k = 0; k < placedText.length; k++) {
    const pf = placedText[k]!
    const r = pf.r
    placedByItem.set(pf.item, pf)
    if (r.trimmedTrailingWhitespace) for (let t = r.tEnd - r.trimmableChars; t < r.tEnd; t++) trimmed.add(p.tSource[t]!)
    for (let s = pf.trimmedEnd; s < r.contentStart + r.contentLength; s++) if (p.sourceT[s] !== -1) trimmed.add(s)
  }
  for (let k = placedText.length - 1; k >= 0; k--) {
    const r = placedText[k]!.r
    const style = p.runStyles[p.frames[r.frame]!.run]!
    if (!(style.whitespaceCanHang && style.whiteSpaceIsSignificant)) break
    if (r.prov === null) continue
    for (let t = r.tEnd - r.trimmableChars; t < r.tEnd; t++) hanging.add(p.tSource[t]!)
    if (r.trimmableChars < r.tEnd - r.prov.startT) break
  }
  const kindOf = (s: number): 'text' | 'trimmed' | 'hanging' => trimmed.has(s) ? 'trimmed' : hanging.has(s) ? 'hanging' : 'text'

  // Fragments in document order over the items the line consumed: collapsed text before and between them (text nodes
  // without frames), each placed text frame's content by its flags, element edges and objects.
  const fragments: Fragment[] = []
  const runOf = (s: number): number => {
    let r = 0
    while (p.runStarts[r + 1]! <= s) r++
    return r
  }
  let cursor = start.contentOffset
  let lastT = -1
  const lastItem = nextStart === null ? p.items.length : next.offset > itemAt(p, next.item) ? next.item + 1 : next.item
  for (let k = start.frame; k < lastItem; k++) {
    const item = p.items[k]!
    if (item.kind !== 'text') {
      pushCollapsed(fragments, runOf, cursor, item.at)
      cursor = Math.max(cursor, item.at)
      switch (item.kind) {
        case 'open': if (!item.split) fragments.push({ kind: 'box-start', element: item.element }); break
        case 'close': if (!item.split) fragments.push({ kind: 'box-end', element: item.element }); break
        case 'atomic': fragments.push({ kind: 'atomic', element: item.element, level: (p.elements[item.element] as Extract<GeckoElement, { kind: 'atomic' }>).level }); break
        case 'br': fragments.push({ kind: 'br', element: item.element }); break
        case 'wbr': fragments.push({ kind: 'wbr', element: item.element }); break
      }
      continue
    }
    const pf = placedByItem.get(k)
    const f = p.frames[item.frame]!
    const to = Math.min(f.end, lineEnd)
    if (pf === undefined) {
      pushCollapsed(fragments, runOf, cursor, to)
      cursor = Math.max(cursor, to)
      continue
    }
    const r = pf.r
    const contentEnd = r.contentStart + r.contentLength
    for (let s = cursor; s < contentEnd;) {
      if (s < r.offset) {
        pushCollapsed(fragments, runOf, s, r.offset)
        s = r.offset
        continue
      }
      const t = p.sourceT[s]!
      if (t === -1) {
        let e = s + 1
        while (e < contentEnd && p.sourceT[e] === -1) e++
        pushCollapsed(fragments, runOf, s, e)
        s = e
        continue
      }
      if (r.endsInNewline && s === contentEnd - 1 && p.tUnits[t] === 0x0a) {
        fragments.push({ kind: 'forced-break', run: f.run, start: s, end: s + 1 })
        s++
        continue
      }
      const kind = kindOf(s)
      let e = s + 1
      while (e < contentEnd && p.sourceT[e] !== -1 && kindOf(e) === kind &&
        !(r.endsInNewline && e === contentEnd - 1 && p.tUnits[p.sourceT[e]!] === 0x0a)) e++
      const tEnd = p.sourceT[e - 1]! + 1
      let painted = ''
      for (let q = t; q < tEnd; q++) painted += String.fromCharCode(p.tUnits[q]!)
      fragments.push({ kind, run: f.run, start: s, end: e, painted, level: f.level })
      lastT = tEnd
      s = e
    }
    cursor = Math.max(cursor, contentEnd)
    // The hyphen of a used soft hyphen follows the frame's content; its advance is inside the frame's box, without letter
    // spacing (AddHyphenToMetrics, nsTextFrame.cpp:6829-6845).
    if (r.usedHyphenation) fragments.push({ kind: 'hyphen', run: f.run, at: contentEnd, painted: '‐', letterSpacing: 0, level: f.level })
  }
  pushCollapsed(fragments, runOf, cursor, lineEnd)

  // The paragraph shaped letters on both sides of this break inside one word: the painter keeps their joining forms.
  let joinsNextLine = false
  if (nextStart !== null && lastT > 0 && lastT < p.tUnits.length && p.unitOf[lastT - 1] === p.unitOf[lastT] &&
    p.units[p.unitOf[lastT]!]!.kind === 'word') {
    joinsNextLine = joinsAcross(p, p.units[p.unitOf[lastT]!]!, lastT)
  }
  // in-word-prefix: the stand-in positions this line rests on. Its width is the advance between its two edges, and its break
  // is the last candidate that fit, which the first one that didn't ended (BreakAndMeasureText, gfxTextRun.cpp:1100-1180):
  // the offset the line starts at, the one it ends at, and the first one the passes consulted past its end. The characters
  // of a unit the line cuts take their advances from the positions inside the part it holds, so those count too; a unit the
  // line holds whole takes its width from its own total, unless a text frame of the line starts or ends inside it: every
  // frame measures its own range (nsTextFrame::ReflowText), so those positions count as well.
  {
    const startT = start.contentOffset < p.nextT.length ? p.nextT[start.contentOffset]! : -1
    const report = new Map<number, string>()
    const partOf = (from: number, to: number): void => {
      // Stand-in positions in [from, to], both inside one unit.
      const run = textRunAt(p, Math.min(from, p.tUnits.length - 1))
      if (run === null) return
      for (let t = from; t <= to && t < p.tUnits.length; t++) {
        // A position inside a cluster counts only where it is asked for by itself: a frame's edge, or one a skipped
        // character exposes. Elsewhere points snap to the cluster's start.
        if (p.clusterStart[t] === 0 && from !== to) continue
        const standIn = advanceBefore(p, m, run, t).standIn
        if (standIn !== null) report.set(p.tSource[t]!, standIn)
      }
    }
    if (startT >= 0 && startT < p.tUnits.length && lastT > startT) {
      const first = p.units[p.unitOf[startT]!]!
      if (first.kind === 'word' && first.tStart < startT) partOf(startT, Math.min(first.tEnd, lastT) - (first.tEnd <= lastT ? 1 : 0))
      const last = lastT < p.tUnits.length ? p.units[p.unitOf[lastT]!]! : null
      if (last !== null && last.kind === 'word' && last.tStart < lastT) partOf(Math.max(last.tStart + 1, startT), lastT)
    }
    for (let k = 0; k < frames.length; k++) {
      const f = frames[k]!
      if (f.kind !== 'text' || f.characters.length === 0) continue
      const from = p.nextT[f.measuredStart]!
      const to = p.nextT[f.contentEnd]!
      if (from < p.tUnits.length) partOf(from, from)
      if (to < p.tUnits.length && to > from) partOf(to, to)
      // A position inside a cluster shows only behind a skipped character: a point snaps back to its cluster's start, but
      // not across a character TransformText removed (FindClusterStart, nsTextFrame.cpp:3549-3560, :8683-8689).
      let skippedInCluster = false
      for (let c = 0; c < f.characters.length; c++) {
        const ch = f.characters[c]!
        if (ch.skipped) skippedInCluster = true
        else if (ch.clusterStart) skippedInCluster = false
        else if (skippedInCluster && ch.standInBefore) partOf(p.sourceT[f.measuredStart + c]!, p.sourceT[f.measuredStart + c]!)
      }
    }
    const endS = lastT >= 0 && lastT < p.tUnits.length ? p.tSource[lastT]! : -1
    let past = -1
    for (const s of gaps.inWord.keys()) if (s > endS && endS >= 0 && (past === -1 || s < past)) past = s
    if (past !== -1) report.set(past, gaps.inWord.get(past)!)
    const offsets = [...report.keys()].sort((a, b) => a - b)
    for (let k = 0; k < offsets.length; k++) {
      const s = offsets[k]!
      gaps.list.push({ gap: 'in-word-prefix', run: p.frames[frameOfSource(p.frames, s)]!.run, detail: report.get(s)!, at: { start: s, end: s } })
    }
  }
  return {
    start: start.contentOffset, end: lineEnd, fragments, hasLineBox: !ll.lineIsEmpty, joinsNextLine, slot, indented, align,
    geometry: {
      appUnitsPerDevPixel: p.appUnitsPerDevPixel, lineLeft: band.left, availableWidth: band.iSize, impactedByFloats: band.impactedByFloats,
      textIndent: indented ? p.textIndentAu : 0, width: lineISize + expansion, hang, alignOffset: dx, frames,
    },
    gaps: gaps.list, next: nextStart,
  }
}

function pushCollapsed(fragments: Fragment[], runOf: (s: number) => number, start: number, end: number): void {
  for (let s = start; s < end;) {
    const run = runOf(s)
    let e = s + 1
    while (e < end && runOf(e) === run) e++
    fragments.push({ kind: 'collapsed', run, start: s, end: e })
    s = e
  }
}
