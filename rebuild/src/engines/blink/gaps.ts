// Named Canvas-versus-DOM gaps (DESIGN.md §5): every condition of the Blink port, with its test, its prose, its merge rule
// and its order. Every raise enters here; gap-accumulator.ts stores the raw list. A gap goes to one of two lists: a line's while that line is filled
// and inspected, for conditions of its break decisions, or the paragraph's with `at`, the source range whose widths the
// condition concerns (model.ts Gap), for conditions of the content itself. A paragraph gap without `at` concerns the
// environment or a font as a whole.
//
// The rest of the port calls in at the program points where a condition can hold, one kind of call per kind of fact: a
// measured range, a view, a HanKerning trim, the hyphen, tabs, the cuts of a wide group, a break candidate, a position
// inside a grapheme, a pair adjustment inside a line. The first parameter is where the gaps go, null on a paragraph
// prepared plain, where every function returns at once: what a function measures to decide its condition is asked of
// Canvas on an inspected paragraph alone.
import type { Gap, GapName } from '../../model.js'
import { GapAccumulator } from './gap-accumulator.js'
import { ParagraphGapIndex } from './paragraph-gap-index.js'
import { hasDictionaryCharacters, languageOf, lineTable } from './breaks.js'
import { collapsesWhiteSpace, isSpaceLB } from './content.js'
import { raw16Of } from './contexts.js'
import { SourceScriptCursor, isSegmentEdge } from './emoji.js'
import type { BlinkLineStart } from './geometry.js'
import { LIGATURE_NONE, LIGATURE_UNCERTAIN } from './ligatures.js'
import { pairPlacementUnknown, positionBounds, positionLimit } from './limits.js'
import type { LineInfo } from './line-breaker.js'
import { USCRIPT_COMMON, USCRIPT_INHERITED, isWhiteSpace, scriptExtensionsOf, scriptOf } from './props.js'
import {
  EXACT16, adjust16, canvasScriptsPerUnit, canvasString, ceilFrom16, clusterStartAtOrBefore, clusterEndAfter, contextsOf, groupPrefix16, isClusterBoundary, isDefaultIgnorableHarfBuzz, isFontRunEdge,
  joinsAcross, measuredAsCommon, pairAdjust16, positionAdjust16, positionForOffset, prefix16, requeuedSpaceAt, spaceTakesScript,
  startsClusterInsideGrapheme, viewPartAt, viewPartCount, type CanvasString, type ViewParts, type ShapeResult, type Shaper,
} from './shape.js'
import type { BlinkInspect, BlinkPrepared } from './types.js'

// Where gaps go while a paragraph is prepared or a line is filled and inspected; null on a paragraph prepared plain.
export type GapSink = GapAccumulator | null

// One entry per gap name, run, detail and range; ranges of one gap, run and detail that meet merge, into the first entry
// they meet. While a list is built its grouping therefore follows the raises, the repeated ones too: a range raised again
// can meet an earlier entry that grew in between and widen it, where the entry holding the range stays as it is when
// nothing raises it again. What the entries cover together doesn't depend on it. Every measurement raises its range's gaps
// (shape.ts measure16), so a measurement made again regroups a list being built (clusters' prefixes carried through
// inspect.ts shapeOf did in 3 of 67,065 recorded cases, positions kept through one binary search in 1;
// research/ARCHITECTURE-PLAN-2.md X2). A list is handed out canonical (canonicalGaps), where grouping follows nothing.
function addGap(gaps: GapAccumulator, gap: GapName, run: number | null, detail: string, at?: { start: number; end: number }): void {
  gaps.add(gap, run, detail, at)
}

// How many gaps a list holds, and the list cut back to that many: the line breaker drops what a search it runs again
// reported (line-breaker.ts shapeLineWith). A range an earlier entry took in by merging stays.
export function gapCount(sink: GapSink): number {
  return sink === null ? 0 : sink.length
}

export function dropGapsFrom(sink: GapSink, count: number): void {
  if (sink !== null) sink.truncate(count)
}

// The source range of text_content [from, to): from the first unit with a source offset to the last one's end. A range
// holding only generated units (a <wbr>'s or an atomic inline's) is the break offset before the next source unit.
function sourceRange(p: BlinkPrepared, from: number, to: number): { start: number; end: number } {
  const end = Math.min(to, p.text.length)
  if (from < end) {
    const first = p.sourceOffsets[from]! >= 0 ? from : p.sourceRuns.end(from)
    const lastUnit = end - 1
    const last = p.sourceOffsets[lastUnit]! >= 0 ? lastUnit : p.sourceRuns.start(lastUnit) - 1
    if (first <= last) return { start: p.sourceOffsets[first]!, end: p.sourceOffsets[last]! + 1 }
  }
  return sourceOffsetAt(p, to)
}

// The source break offset at text_content offset k: the source offset of the first unit at or after k.
function sourceOffsetAt(p: BlinkPrepared, k: number): { start: number; end: number } {
  let at = p.index.text.length
  if (k < p.text.length) {
    const first = p.sourceOffsets[k]! >= 0 ? k : p.sourceRuns.end(k)
    if (first < p.text.length) at = p.sourceOffsets[first]!
  }
  return { start: at, end: at }
}

// The source range of the grapheme around text_content offset k (k inside it or at its start).
function graphemeSourceRange(p: BlinkPrepared, k: number): { start: number; end: number } {
  let a = Math.min(k, p.text.length)
  if (p.graphemeStarts[a] !== 1) a = p.inspect!.graphemeRuns!.start(a) - 1
  let b = a + 1
  if (b < p.text.length && p.graphemeStarts[b] !== 1) b = p.inspect!.graphemeRuns!.end(b)
  return sourceRange(p, a, Math.min(b, p.text.length))
}

// The text leaf that holds source unit s: the last one that starts at or before it (an empty leaf holds no unit, and none
// can start at or before s after the leaf that holds it).
export function runOfSource(p: BlinkPrepared, s: number): number {
  const leaves = p.index.leaves
  let lo = 0
  let hi = leaves.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (leaves[mid]!.start <= s) lo = mid
    else hi = mid - 1
  }
  return lo
}

// The run of text_content unit k, or null for a unit Blink generated or an element's.
function runAt(p: BlinkPrepared, k: number): number | null {
  const source = p.sourceOffsets[k]!
  return source >= 0 ? runOfSource(p, source) : null
}

// The source range of the glyph clusters on both sides of offset k inside a shaping call over [lo, hi).
function clustersAround(p: BlinkPrepared, k: number, lo: number, hi: number): { start: number; end: number } {
  return sourceRange(p, clusterStartAtOrBefore(p, k - 1, lo), clusterEndAfter(p, k, hi))
}

// ---- A measured range (shape.ts measure16) ----

const JOINING_DETAIL = 'a shaping call edge between joining letters (a group edge, or a reshape the line breaker measured, chosen or not) in a font the declaration gives no joining fact for: Blink shapes each side with HarfBuzz context, which OpenType fonts join through and AAT (morx) fonts such as Geeza Pro don\'t (hb-ot-shape.cc:60-66, 100-101; probe blink-followups F1); the port measures the edge as an AAT font gives it'

const CONTEXT_DETAIL = 'a shaping call edge between joining letters in an OpenType joining font: U+200D stands in for the context HarfBuzz reads, which gives the joined forms but not contextual alternates that read the letters beyond it (DESIGN.md §5 unsafe-to-break: contextual forms across a chosen edge)'

// An edge k of a range measured as part of a shaping call over [callStart, callEnd) of group g, where the text on the other
// side joins (shape.ts joinedAtEdge): at the call's own edge the letters join only when the font reads HarfBuzz's context
// (FontFacts.joining 'opentype'), where U+200D stands in for it. Where the fact isn't given the edge decides a width, so
// the measurement reports joining-technology.
function callEdge(gaps: GapAccumulator, p: BlinkPrepared, g: number, k: number, callStart: number, callEnd: number): void {
  if (k > callStart && k < callEnd) return
  const style = p.styles[p.groups[g]!.style]!
  switch (style.font.facts.joining) {
    case 'opentype':
      if (joinsAcross(p, k, callStart, callEnd)) addGap(gaps, 'unsafe-to-break', style.run, CONTEXT_DETAIL, sourceOffsetAt(p, k))
      return
    case 'aat': return
    case null:
      if (joinsAcross(p, k, callStart, callEnd)) addGap(gaps, 'joining-technology', style.run, JOINING_DETAIL, sourceOffsetAt(p, k))
      return
  }
}

const SCRIPT_CONTEXT_DETAIL = 'a Canvas string the layout measures shapes the character under another script than the paragraph: RunSegmenter resolves Common and Inherited characters from their neighbours over the whole text_content in the DOM, reshapes included (harfbuzz_shaper.cc:1080-1101), and over the measured word alone in Canvas (plain_text_node.cc:372-425, script_run_iterator.cc), so a font with other lookups for the two scripts shapes it otherwise'

// Whether [from, to) holds a character other than white space whose Script property is Common or Inherited or that has
// Script_Extensions: the characters ScriptRunIterator resolves from context.
function hasScriptNeutral(p: BlinkPrepared, from: number, to: number): boolean {
  for (let i = from; i < to;) {
    const cp = p.text.codePointAt(i)!
    i += cp > 0xffff ? 2 : 1
    if (isWhiteSpace(cp)) continue
    const script = scriptOf(cp)
    if (script === USCRIPT_COMMON || script === USCRIPT_INHERITED || scriptExtensionsOf(cp).length > 1) return true
  }
  return false
}

// The ISO 15924 code of a script HarfBuzz shapes with its default shaper (hb_ot_shaper_categorize, hb-ot-shaper.hh: none
// of them is in its switch), by UScriptCode number: Common, Inherited, Bopomofo, Cyrillic, Greek, Han, Hiragana, Katakana,
// Latin. Null for every other script.
function defaultShaperScript(script: number): string | null {
  switch (script) {
    case 0: return 'Zyyy'
    case 1: return 'Zinh'
    case 5: return 'Bopo'
    case 8: return 'Cyrl'
    case 14: return 'Grek'
    case 17: return 'Hani'
    case 20: return 'Hira'
    case 22: return 'Kana'
    case 25: return 'Latn'
    default: return null
  }
}

// Whether HarfBuzz shapes the character at text_content unit t alike under the two scripts: the font that draws it, by the
// declaration's coverage facts, selects the same GSUB and GPOS lookups for both (ListedFontFacts.scriptLookups: scripts of
// one group, or both outside every group, share their lookups under every language system;
// hb_ot_layout_table_select_script, hb-ot-layout.cc:561-608), and both take the default shaper, so nothing else in the
// shaping plan follows the script. The direction is the call's either way. Then Canvas resolving the character otherwise
// than the paragraph changes no glyph and no advance. Without the facts, or under a script with a shaper of its own
// (Arabic, Hebrew, Thai, Hangul, the Indic and USE scripts), the difference stays a condition.
function shapesAlike(p: BlinkPrepared, t: number, canvasScript: number, domScript: number): boolean {
  const a = defaultShaperScript(canvasScript)
  const b = defaultShaperScript(domScript)
  if (a === null || b === null) return false
  const f = p.fontRun[t]!
  if (f < 0) return false
  const g = p.groupOfUnit[t]!
  if (g < 0) return false
  const fonts = p.styles[p.groups[g]!.style]!.font.facts.fonts
  const lookups = fonts === undefined ? null : fonts[f]!.scriptLookups
  if (lookups === null) return false
  let groupA = -1
  let groupB = -1
  for (let i = 0; i < lookups.length; i++) {
    if (lookups[i]!.includes(a)) groupA = i
    if (lookups[i]!.includes(b)) groupB = i
  }
  return groupA === groupB
}

// script-context for every stretch of the measured string, white space apart, that Canvas shapes under another script than
// the paragraph does.
function scriptContext(gaps: GapAccumulator, p: BlinkPrepared, units: readonly number[], scripts: Uint8Array, domScript: number, sourceOrdinal: number): void {
  const source = sourceOrdinal < 0 ? null : new SourceScriptCursor(p.segments!, sourceOrdinal, domScript)
  let start = -1
  let end = -1
  const flush = (): void => {
    if (start < 0) return
    addGap(gaps, 'script-context', runAt(p, start), SCRIPT_CONTEXT_DETAIL, sourceRange(p, start, end))
    start = -1
  }
  for (let u = 0; u < units.length; u++) {
    const t = units[u]!
    if (t < 0) continue
    const c = p.text.charCodeAt(t)
    if ((c & 0xfc00) === 0xdc00) { if (start >= 0) end = t + 1; continue }
    const cp = p.text.codePointAt(t)!
    // A default-ignorable character keeps no advance under any script: HarfBuzz zeroes it after positioning, and Blink sets
    // no buffer flag that would keep it (hb_ot_zero_width_default_ignorables, hb-ot-shape.cc:779-799). What it does to its
    // neighbours' lookups is soft-hyphen-shaping's and the cluster rules' business.
    const sourceScript = source === null ? domScript : source.at(t)
    if (isWhiteSpace(cp) || isDefaultIgnorableHarfBuzz(cp) || scripts[u] === sourceScript || shapesAlike(p, t, scripts[u]!, sourceScript)) { flush(); continue }
    if (start < 0) start = t
    end = t + 1
  }
  flush()
}

// text_content[from, to) of group g, measured as the Canvas string `cs` as part of a shaping call over [callStart,
// callEnd): its two edges, and the scripts Canvas shapes the string under, which matter where they differ from the
// paragraph's: only a character without a script of its own can, and an 8-bit string is a Latin range shaped as Latin on
// both sides. `scripts` are the ones the measurement itself read, for the letter spacing (shape.ts measure16); without
// letter spacing only this condition reads them.
export function measuredRange(sink: GapSink, p: BlinkPrepared, g: number, from: number, to: number, callStart: number, callEnd: number, cs: CanvasString, scripts: Uint8Array | null, domScript: number, sourceOrdinal: number = -1): void {
  if (sink === null) return
  callEdge(sink, p, g, from, callStart, callEnd)
  callEdge(sink, p, g, to, callStart, callEnd)
  const canvasScripts = scripts ?? (cs.twoByte && hasScriptNeutral(p, from, to) ? canvasScriptsPerUnit(p, p.groups[g]!.style, cs.s, p.groups[g]!.rtl) : null)
  // A non-null sink requested the map in measure16.
  if (canvasScripts !== null) scriptContext(sink, p, cs.units!, canvasScripts, domScript, sourceOrdinal)
}

// ---- The cuts of a group of 256 zoomed px or more (shape.ts addPieces) ----

export function uncutCluster(sink: GapSink, p: BlinkPrepared, g: number, a: number, b: number): void {
  if (sink === null) return
  addGap(sink, 'float32-precision', p.styles[p.groups[g]!.style]!.run, 'a grapheme cluster of 256 zoomed px or more', sourceRange(p, a, b))
}

export function roundedPiece(sink: GapSink, p: BlinkPrepared, g: number, a: number, b: number): void {
  if (sink === null) return
  addGap(sink, 'float32-precision', p.styles[p.groups[g]!.style]!.run, 'a piece whose Canvas answer was 256 zoomed px or more, rounded by at most a unit, and whose total the spacing brings below 256', sourceRange(p, a, b))
}

export function unsafeCut(sink: GapSink, p: BlinkPrepared, g: number, k: number): void {
  if (sink === null) return
  addGap(sink, 'unsafe-to-break', p.styles[p.groups[g]!.style]!.run, 'a shaping group of 256 zoomed px or more has no offset near its middle that the pair test calls safe; the pieces add the pair adjustment there', sourceOffsetAt(p, k))
}

// ---- Words first (shape.ts addWordPieces, line-breaker.ts candidateAt) ----

const CONTEXT_PAST_A_WORD_DETAIL = 'the positions summed from words differ from the ones the cut search of a group of 256 zoomed px gives: the port cuts a group at a space where the two words around it measure together what they measure apart, on the premise that no shaping context reaches more than one word past a space, and here one does (DESIGN.md §4.6, "Blink\'s words first")'

// A read of group g's own call at offset k that the cut search's cuts and the words' cuts give differently
// (shape.ts heldAgainstSearch): a position or the wide window's adjustment there.
export function contextPastAWord(sink: GapSink, p: BlinkPrepared, g: number, k: number): void {
  if (sink === null) return
  const group = p.groups[g]!
  addGap(sink, 'context-past-a-word', p.styles[group.style]!.run, CONTEXT_PAST_A_WORD_DETAIL, clustersAround(p, Math.min(k, group.end), group.start, group.end))
}

// A line end at x whose candidate the walk over the group's cuts and the search over every offset settle differently
// (line-breaker.ts candidateAt): a position inside a word lies past a later one, so the positions aren't sorted where
// the two read them, which both rest on (DESIGN.md §4.6, "Blink's words first"). The line takes the walk's candidate, the plain
// paragraph's.
export function positionsRunBackwards(sink: GapSink, sh: Shaper, sr: ShapeResult, x: number, walked: number, searched: number, start: number): void {
  if (sink === null || sr.kind !== 'group') return
  const p = sh.p
  const at = (k: number): number => sourceOffsetAt(p, k).start
  addGap(sink, 'positions-run-backwards', p.styles[p.groups[sr.group]!.style]!.run, `from offset ${at(start)}, at ${x} LayoutUnits, the walk over the cuts settles on offset ${at(walked)} and the search over every offset on ${at(searched)}: a position inside a word lies past a later one, and the line takes the walk's candidate`, sourceRange(p, Math.min(walked, searched), Math.max(walked, searched) + 1))
}

// ---- The cut predictor (shape.ts windowAdjust16) ----

const NESTED_WINDOW_WIDER_DETAIL = 'the window the shrink of the wide window takes here is not the one predicted from the total of the widest window: a string measures narrower than a window inside it by more than the zoomed font size, which the prediction rests on (DESIGN.md §4.6, "Blink\'s cut predictor"); the adjustment is the prediction\'s window\'s'

// The shrink of the wide window across offset k of group g and the prediction of the window it takes, over the same
// totals, take different windows (shape.ts windowAdjust16).
export function nestedWindowWider(sink: GapSink, p: BlinkPrepared, g: number, k: number): void {
  if (sink === null) return
  const group = p.groups[g]!
  addGap(sink, 'nested-window-wider', p.styles[group.style]!.run, NESTED_WINDOW_WIDER_DETAIL, clustersAround(p, Math.min(k, group.end), group.start, group.end))
}

// ---- The sides of a window (shape.ts windowAdjust16) ----

const WHITE_SPACE_SIDE_DETAIL = 'a window side of white space alone, in a face whose space takes another advance under Common than under Latin (shape.ts spaceTakesScript): Canvas shapes the side alone as Common, where the paragraph shapes its spaces under the run\'s script (RunSegmenter over the measured string, plain_text_node.cc:400-425, harfbuzz_shaper.cc:1072-1101; Euphemia UCAS\'s GPOS moves its space and no-break space by -422 font units under latn alone), so the adjustment the window shows across the offset holds the difference of the side\'s spaces (DESIGN.md §4.6, "Blink\'s words first")'

const COMMON_SIDE_DETAIL = 'a window side that Canvas shapes as Common alone, where the paragraph shapes it under its run\'s script (digits or punctuation between letters of one script, shape.ts measuredAsCommon), decided the adjustment across the offset or held the range being cut against it: RunSegmenter resolves such a string over itself (plain_text_node.cc:400-425, script_run_iterator.cc), so the adjustment can be the side\'s script and not context, and a cut the range vetoes moves (DESIGN.md §4.6, "Blink\'s words first")'

// Whether side [from, to) of a window is white space and default-ignorable characters alone, a space or a no-break space
// among them, which Canvas shapes as Common where the paragraph shapes it under its run's script: the side's Canvas string
// is 16-bit (shape.ts canvasString: U+0020 is U+2028 in a segmented paragraph, and a short range under another script
// than Latin takes U+2060 before it), where an 8-bit one is one Latin segment, as the paragraph's Latin range is.
function whiteSpaceSide(p: BlinkPrepared, from: number, to: number): boolean {
  if (p.segments === null || from >= to) return false
  let space = false
  for (let i = from; i < to; i++) {
    const c = p.text.charCodeAt(i)
    if (c === 0x20 || c === 0xa0) space = true
    else if (!isWhiteSpace(c) && !isDefaultIgnorableHarfBuzz(c)) return false
  }
  const domScript = p.segments.scriptAt(from)
  return space && domScript !== USCRIPT_COMMON && canvasString(p, from, to, false, false, domScript, false, false).twoByte
}

// The window [a, b) whose adjustment `d` across offset k inside a call over [lo, hi) of group g windowAdjust16 took: the
// exact window, or the range being cut held against its two sides. Where a side of it is white space alone in a face whose
// space takes the script, or Canvas shapes a side as Common where the paragraph doesn't and the window showed an
// adjustment, what the window shows is the side's script as much as context, and the offset reports script-context: the
// clusters around k, whose position or cut the window decides.
export function windowSides(sink: GapSink, p: BlinkPrepared, g: number, k: number, a: number, b: number, lo: number, hi: number, d: number): void {
  if (sink === null) return
  const style = p.groups[g]!.style
  const run = p.styles[style]!.run
  if ((whiteSpaceSide(p, a, k) || whiteSpaceSide(p, k, b)) && spaceTakesScript(p, style)) addGap(sink, 'script-context', run, WHITE_SPACE_SIDE_DETAIL, clustersAround(p, k, lo, hi))
  if (d !== 0 && (measuredAsCommon(p, g, a, k) || measuredAsCommon(p, g, k, b))) addGap(sink, 'script-context', run, COMMON_SIDE_DETAIL, clustersAround(p, k, lo, hi))
}

// ---- A HanKerning trim the port adds to a shaping call (shape.ts) ----

const HAN_KERNING_DETAIL = 'a HanKerning trim added from Canvas facts: `halt` through the 「「 pair trim and character types from ink bounds (han_kerning.cc:417-535)'

// The halted character is the one at text_content offset `at`.
export function hanKerningTrim(sink: GapSink, p: BlinkPrepared, style: number, at: number): void {
  if (sink === null) return
  addGap(sink, 'han-kerning', p.styles[style]!.run, HAN_KERNING_DETAIL, sourceRange(p, at, at + 1))
}

// A line-end halt (shape.ts reshapeHanKerningEnd) on a character whose trim Canvas can't show.
export function hanKerningEndUnknown(sink: GapSink, p: BlinkPrepared, style: number, at: number): void {
  if (sink === null) return
  addGap(sink, 'han-kerning', p.styles[style]!.run, 'a line-end halt on a character that isn\'t a fullwidth open or close mark: Canvas can\'t show whether its font halts it (shaping_line_breaker.cc:344-363)', sourceRange(p, at, at + 1))
}

// ---- A view (shape.ts makeView, floatWidthOfParts) ----

const GRAPHEME_CLUSTERS_DETAIL = 'a position inside a grapheme at a character HarfBuzz doesn\'t mark a continuation: the glyphs form one cluster or two as the font\'s lookups merge them (ligate_input, hb-ot-layout-gsubgpos.hh:1500-1510), which Canvas totals don\'t show; the port gives the grapheme one position'

// A view edge inside a grapheme (a line edge, a bidi run edge, trailing spaces split off) takes the grapheme's position.
export function viewEdges(sink: GapSink, p: BlinkPrepared, parts: ViewParts): void {
  if (sink === null) return
  for (let i = 0, count = viewPartCount(parts); i < count; i++) {
    const part = viewPartAt(parts, i)
    const g = part.kind === 'reshape' ? part.call.group : part.sr.kind === 'group' ? part.sr.group : -1
    if (g < 0) continue
    for (const edge of [part.start, part.end]) {
      if (startsClusterInsideGrapheme(p, edge)) addGap(sink, 'glyph-clusters', p.styles[p.groups[g]!.style]!.run, GRAPHEME_CLUSTERS_DETAIL, graphemeSourceRange(p, edge))
    }
  }
}

const FLOAT_DETAIL = 'glyphs of 256 zoomed px or more drawn by a font the declaration\'s facts don\'t name: Blink adds every HarfBuzz run\'s width as a float (shape_result_view.cc:215-273), and one run per stretch a fallback font draws, so the float32 sum rounds by where those runs are, and the ceiled size can differ by a LayoutUnit'

// A run of a view whose glyphs a font the facts don't name draws, past 256 zoomed px of the view's float sum: `prefix` is
// the advance sum before an offset of the run's part.
export type UnknownRun = { prefix: (k: number) => number; from: number; to: number }

// A view's float sum of 256 zoomed px or more (shape.ts floatWidthOfParts), whose exact total is `total16` over text_content
// [first, last): `slack16` is how far the float sum can be from it, where a run of a font the facts don't name may be one
// run per cluster, and `bits` every run's advance or'ed. Every advance the sum could add alone is or'ed in: a float32 holds
// 24 bits, so sums of multiples of 2^g units are exact below 2^(24 + g) units wherever the runs are (a 2048-unit font at a
// whole zoomed size of 32 px has advances in multiples of 1024 units, exact below 2^18 px).
export function floatSum(sink: GapSink, p: BlinkPrepared, total16: number, slack16: number, bits: number, first: number, last: number, unknownRuns: readonly UnknownRun[]): void {
  if (sink === null) return
  if (!(slack16 > 0 && first >= 0 && Math.ceil((total16 - slack16) / 1024) !== Math.ceil((total16 + slack16) / 1024))) return
  for (let u = 0; u < unknownRuns.length; u++) {
    const run = unknownRuns[u]!
    let before = run.prefix(run.from)
    for (let k = run.from + 1; k <= run.to; k++) {
      if (k < run.to && !isClusterBoundary(p, k)) continue
      const at = run.prefix(k)
      bits |= at - before
      before = at
    }
  }
  const granularity = bits === 0 ? 2 ** 31 : bits & -bits
  if (total16 >= EXACT16 * granularity) addGap(sink, 'float32-precision', runAt(p, first), FLOAT_DETAIL, sourceRange(p, first, last))
}

// ---- The hyphen and tabs (shape.ts shapeHyphen, tabShapeResult) ----

// LineBreaker::AddHyphen shapes the hyphen whenever a break at a soft hyphen is tried (line_breaker.cc:728-760), and its
// width decides whether the break fits. Where mapsHyphen isn't given and U+002D measures differently in the run's
// context, that decision rests on the default, so the line being filled reports hyphen-glyph. `raw16` is the hyphen's
// measured width.
export function hyphenGlyph(sink: GapSink, p: BlinkPrepared, style: number, raw16: number): void {
  const st = p.styles[style]!
  if (sink === null || st.font.facts.mapsHyphen !== null) return
  // U+002D is a one-byte string, measured on the style's one-byte contexts.
  const oneByte = contextsOf(p, style, false)
  if (raw16 !== raw16Of(oneByte, oneByte.hyphen, '-')) {
    addGap(sink, 'hyphen-glyph', st.run, 'a soft hyphen break the line breaker tried in a font the declaration gives no mapsHyphen fact for: Blink draws U+2010 when the primary font maps it and U+002D otherwise, and the two measure differently here (computed_style.cc:1804-1820)')
  }
}

export function tabStops(sink: GapSink, p: BlinkPrepared, run: number, start: number, end: number): void {
  if (sink === null) return
  addGap(sink, 'tab-stops', run, 'tab stops count from the platform space advance, without `trak` tracking and untruncated; Canvas gives the tracked 16.16 advance (simple_font_data.cc:225-240, font.cc:303-340)', sourceRange(p, start, end))
}

// ---- A break candidate and a line-end fit test (line-breaker.ts shapeLineWith) ----

const CANDIDATE_DETAIL = 'the break candidate came from a paragraph position the port can\'t place: the shaping adjusts the glyphs on both sides of the offset (joined forms that change each other, a kern no fact places), Canvas totals show the sum and not which glyph carries it, and the space left ends between the two places it could be (CachedOffsetForPosition, shaping_line_breaker.cc:326-329)'

// The candidate rests on the positions of the offsets around it. Where one of them is a stand-in whose adjustment the port
// can't place and the end position lies within what it could be (positionBounds), the candidate can be another one
// natively: the line reports unsafe-to-break at that offset.
export function breakCandidate(sink: GapSink, sh: Shaper, sr: ShapeResult, endPosition: number, candidate: number, start: number): void {
  if (sink === null || sr.kind !== 'group') return
  const p = sh.p
  const near: number[] = []
  let before = candidate - 1
  while (before > start && !isClusterBoundary(p, before)) before--
  let after = candidate + 1
  while (after < sr.end && !isClusterBoundary(p, after)) after++
  near.push(before, candidate, after)
  for (let i = 0; i < near.length; i++) {
    const k = near[i]!
    if (k <= start || k >= sr.end) continue
    const bounds = positionBounds(sh, sr, k)
    if (bounds === null || endPosition < bounds[0] || endPosition > bounds[1]) continue
    // The condition concerns the glyph clusters on both sides of k, whose shares of the adjustment aren't known.
    addGap(sink, 'unsafe-to-break', runAt(p, k), CANDIDATE_DETAIL, clustersAround(p, k, sr.start, sr.end))
  }
}

// The condition the clamp of a wrapped line start's corrected space rests on, where the start's paragraph position is a
// stand-in (line-breaker.ts shapeLineWith); null where the port knows the position. Not a gap yet: the line breaker lays
// the line out the other way too, and the line reports the start only when that gives another line (LineInfo.clampedStarts).
export function clampedStartLimit(sink: GapSink, sh: Shaper, g: number, start: number): GapName | null {
  if (sink === null) return null
  const group = sh.p.groups[g]!
  return positionLimit(sh, g, start, group.start, group.end)
}

// Whether a line-end fit test could go the other way natively (line-breaker.ts EndTest), by the rounding of the last safe
// offset's position. `margin16` is the space left less the reshape's width, in 16.16 units; `endKnown` and `startKnown`
// say whether Blink's last safe offset and the wrapped line start's first safe offset are the port's for sure.
export function endTestCouldTurn(sink: GapSink, sh: Shaper, sr: ShapeResult, lastSafe: number, margin16: number, fits: boolean, endKnown: boolean, startKnown: boolean): boolean {
  if (sink === null) return false
  // How far the ceiling of the last safe offset's position is above the position, 0 to 1023: an earlier safe offset has
  // another. Positions run down in RTL, where a higher ceiling leaves more space, not less.
  const position16 = prefix16(sh, sr, lastSafe)
  const exact16 = !sr.rtl ? position16 : sr.width16 - position16
  const slack16 = positionForOffset(sh, sr, lastSafe) * 1024 - exact16
  const shift16 = startKnown ? 0 : 1024
  let low16 = margin16 - shift16
  let high16 = margin16 + shift16
  if (!endKnown) {
    if (!sr.rtl) { low16 += slack16 - 1023; high16 += slack16 } else { low16 -= slack16; high16 += 1023 - slack16 }
  }
  return !(fits ? low16 >= 0 : high16 < 0)
}

// ---- Positions inside a line (pieces.ts trailingSpacesOf, inspect.ts shapeOf) ----

// A position asked inside a grapheme at a character HarfBuzz doesn't mark a continuation (shape.ts isClusterBoundary).
export function positionInsideGrapheme(sink: GapSink, p: BlinkPrepared, k: number): void {
  if (sink === null) return
  if (startsClusterInsideGrapheme(p, k)) addGap(sink, 'glyph-clusters', runAt(p, k), GRAPHEME_CLUSTERS_DETAIL, graphemeSourceRange(p, k))
}

const PAIR_PLACEMENT_DETAIL = 'glyph clusters inside a line with a pair adjustment between them, in a font the declaration gives no pairKerning fact for: GPOS pair values sit on the first glyph\'s advance and the kern and kerx machine gives each glyph half (hb-kern.hh:102-106), Canvas totals show the sum, and the port puts all of it on the first glyph, so the two advances and every position between them can be half the adjustment off'

// A pair adjustment at a glyph cluster's edge k whose side isn't known (limits.ts pairPlacementUnknown): the clusters around
// it are stand-ins.
export function pairPlacement(sink: GapSink, sh: Shaper, g: number, k: number, callStart: number, callEnd: number): void {
  if (sink === null) return
  if (pairPlacementUnknown(sh, g, k, callStart, callEnd)) addGap(sink, 'unsafe-to-break', runAt(sh.p, k), PAIR_PLACEMENT_DETAIL, clustersAround(sh.p, k, callStart, callEnd))
}

// ---- The paragraph's gaps ----

const SCALED_DETAIL = 'advances measured in a font made for the CSS size and scaled to the DOM\'s font size: Blink truncates each glyph\'s advance to 1/65536 px at its own size (skia_text_metrics.cc:207-211), so a sum of scaled advances can be a few units off the DOM\'s, which moves a width or a fit test that lies that close to a LayoutUnit'

const PLATFORM_FONT_DETAIL = 'a font with an opsz axis: the DOM sets the axis from the specified size (font_platform_data_mac.mm:170-178) and takes the platform font from a cache of the renderer process whose key holds the zoomed size alone (font_cache_key.h:53-68, font_description.cc:308-331), so text or a canvas that asked for this family at the same zoomed size under another specified size first decides the optical size of both (Chromium #489579956)'

const SOFT_HYPHEN_DETAIL = 'SHY, which Canvas measures as U+2060 in a 16-bit string, where the DOM shapes SHY\'s own glyph in one Latin segment (hb-aat-layout-common.hh:1226-1241): a word\'s total is the DOM\'s in every installed family probed, and a position beside SHY rests on the pair window across it'

// The source ranges of the text items under a style.
function styleRanges(p: BlinkPrepared, items: readonly number[]): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = []
  for (const index of items) {
    const item = p.items[index]!
    ranges.push(sourceRange(p, item.start, item.end))
  }
  return ranges
}

// The conditions of the content, each with the source range it concerns (DESIGN.md §2.8, §5).
function contentGaps(gaps: GapAccumulator, p: BlinkPrepared): number[][] {
  const byStyle: number[][] = Array.from({ length: p.styles.length }, () => [])
  for (let i = 0; i < p.items.length; i++) {
    const item = p.items[i]!
    if (item.type !== 'text' || item.start === item.end) continue
    byStyle[item.style]!.push(i)
    const collapses = collapsesWhiteSpace(p.styles[item.style]!.whiteSpace)
    for (let k = item.start; k < item.end; k++) {
      const c = p.text.charCodeAt(k)
      // Canvas turns VT and FF into spaces (plain_text_node.cc:47-52, character.h:226-240), which the port replaces with
      // U+0001; other controls reach both paths as they are. In preserve modes FF is a control item.
      if (c === 0x0b || (c === 0x0c && collapses)) {
        addGap(gaps, 'control-character-width', item.run, 'VT or FF measured as U+0001, which takes the fallback font Core Text picks for a control; the width isn\'t probed (specs/blink-gaps.md §2.8)', sourceRange(p, k, k + 1))
      }
      // Canvas turns U+FFFC into U+200B (plain_text_node.cc:52-58, character.h:167-175); the DOM shapes it with a fallback glyph.
      if (c === 0xfffc) addGap(gaps, 'font-fallback', item.run, 'U+FFFC in text: Canvas measures it as U+200B', sourceRange(p, k, k + 1))
      // canvasString writes these as U+2060, which makes the string 16-bit in a paragraph RunSegmenter doesn't segment.
      if (p.segments === null && (c === 0xad || c === 0x200b || c === 0x200e || c === 0x200f || (c >= 0x202a && c <= 0x202e) || c === 0xfeff)) {
        addGap(gaps, 'soft-hyphen-shaping', item.run, SOFT_HYPHEN_DETAIL, sourceRange(p, k, k + 1))
      }
    }
    if (p.env.dictionaryBreaks.kind === 'unavailable' &&
      hasDictionaryCharacters(p.text, item.start, item.end, lineTable(p.styles[item.style]!.locale, p.styles[item.style]!.iterator.strictness, p.env.uiLanguage))) {
      addGap(gaps, 'dictionary-breaks-unavailable', item.run, 'Thai, Lao, Khmer or Myanmar text without the running browser\'s Intl.v8BreakIterator: no break opportunities inside such runs (DESIGN.md §6.3)', sourceRange(p, item.start, item.end))
    }
  }
  return byStyle
}

// The gaps of the prepared content, its fonts' facts and the environment (DESIGN.md §2.8), after the ones preparation's
// measuring raised. They end the paragraph's list, which the prepared paragraph keeps canonical from here on: a line's
// gaps take in the ones whose ranges meet what its decision measured (lineEdgeGaps).
export function preparedContent(p: BlinkPrepared, sink: GapSink): void {
  if (p.inspect === null || sink === null) return
  const byStyle = contentGaps(sink, p)
  for (let s = 0; s < p.styles.length; s++) {
    const style = p.styles[s]!
    const ranges = (): { start: number; end: number }[] => styleRanges(p, byStyle[s]!)
    if (p.env.uiLanguage === null && (style.locale === null || (languageOf(style.locale) === 'ko' && style.iterator.strictness === 'strict'))) {
      for (const at of ranges()) addGap(sink, 'ui-language', style.run, 'content without a locale, or ko with line-break: strict, follows Chrome\'s application locale, which isn\'t given: break tables, generic families and the HarfBuzz language (specs/blink-canvas.md §2.3)', at)
    }
    if (p.layoutZoom !== 1) {
      const unknown = style.font.facts.opticalSizeAxis === null
      if (unknown || style.measuresAtCssSize) {
        const detail = `${unknown ? 'whether the fonts have an opsz axis isn\'t given; ' : ''}${style.measuresAtCssSize ? SCALED_DETAIL : 'measured at the zoomed size'} (font_platform_data_mac.mm:170-178, probes-chrome correction 7)`
        for (const at of ranges()) addGap(sink, 'optical-size', style.run, detail, at)
      }
      // The renderer's font cache, not this text: the gap has no range, so it explains no line by where it is. Alone in a
      // fresh process the DOM's widths are the same whether Canvas or the DOM asked first (research/ROUND3-CRITIC.md item 1).
      if (style.measuresAtCssSize) addGap(sink, 'page-history', style.run, PLATFORM_FONT_DETAIL)
    }
  }
  for (let g = 0; g < p.groups.length; g++) {
    const group = p.groups[g]!
    // An element edge inside an extended grapheme cluster splits a sequence the DOM shapes in two calls (e.g. a keycap or
    // emoji ZWJ sequence across spans); Canvas measures each part alone and may pick other glyphs.
    if (group.start > 0 && p.graphemeStarts[group.start] !== 1) {
      addGap(sink, 'font-fallback', p.styles[group.style]!.run, 'a shaping-group edge inside a grapheme cluster', graphemeSourceRange(p, group.start))
    }
  }
  p.inspect.gaps = canonicalGaps(sink.snapshot())
  p.inspect.paragraphIndex = new ParagraphGapIndex(p.inspect.gaps)
}

// What inspectLine and paragraphGaps read of a prepared paragraph; they throw on one prepared plain.
function inspected(p: BlinkPrepared, what: string): BlinkInspect {
  if (p.inspect === null) throw new Error(`${what} reads an inspected paragraph, and this one was prepared plain`)
  return p.inspect
}

// A list as it is handed out: for every gap, run and detail, the ranges its entries cover together as ranges that don't
// meet, each at the place of the first entry it took in, which is where that range was first raised. So a list says what
// was raised and in what order it first was, and not how often or in what order ranges were raised again. The entries are
// copies: nothing handed out is the prepared paragraph's own, or a list still being built.
export function canonicalGaps(gaps: readonly Gap[]): Gap[] {
  // These are private engine lists: source mapping and GapAccumulator produce finite integer
  // ranges with start <= end, and run is a text-leaf index or null. Source coordinates include EOF points.
  const groups = new Map<GapName, Map<number | null, Map<string, number[]>>>()
  // A component goes in its earliest input entry's slot. Scalars keep their own slots, including repeats.
  const slots: (Gap | undefined)[] = new Array(gaps.length)
  for (let i = 0; i < gaps.length; i++) {
    const gap = gaps[i]!
    if (gap.at === undefined) { slots[i] = copyOf(gap); continue }
    let runs = groups.get(gap.gap)
    if (runs === undefined) { runs = new Map(); groups.set(gap.gap, runs) }
    let details = runs.get(gap.run)
    if (details === undefined) { details = new Map(); runs.set(gap.run, details) }
    let ranges = details.get(gap.detail)
    if (ranges === undefined) { ranges = []; details.set(gap.detail, ranges) }
    ranges.push(i)
  }
  for (const runs of groups.values()) for (const details of runs.values()) for (const ranges of details.values()) {
    ranges.sort((a, b) => gaps[a]!.at!.start - gaps[b]!.at!.start || a - b)
    let first = ranges[0]!, start = gaps[first]!.at!.start, end = gaps[first]!.at!.end
    for (let r = 1; r <= ranges.length; r++) {
      const i = ranges[r]
      if (i !== undefined && gaps[i]!.at!.start <= end) {
        first = Math.min(first, i)
        start = Math.min(start, gaps[i]!.at!.start)
        end = Math.max(end, gaps[i]!.at!.end)
      } else {
        slots[first] = { ...gaps[first]!, at: { start, end } }
        if (i !== undefined) { first = i; start = gaps[i]!.at!.start; end = gaps[i]!.at!.end }
      }
    }
  }
  const out: Gap[] = []
  for (let i = 0; i < slots.length; i++) if (slots[i] !== undefined) out.push(slots[i]!)
  return out
}

// The gaps of the paragraph's content, fonts and environment, whatever the slot (DESIGN.md §5).
export function paragraphGaps(p: BlinkPrepared): Gap[] {
  return inspected(p, 'paragraphGaps').gaps.map(copyOf)
}

function copyOf(gap: Gap): Gap {
  return gap.at === undefined ? { ...gap } : { ...gap, at: { ...gap.at } }
}

// ---- A decided line's gaps ----

const ATTRIBUTION_DETAIL = 'a line edge taken from the paragraph position where the shaping adjusted the glyphs on both sides: Canvas totals show the adjustment but not which glyph carries it (GPOS first-glyph values, legacy kern d >> 1; specs/blink-gaps.md §3.6 L1)'
const LIGATURE_DETAIL = 'a chosen line edge where the pair total shows the shaping adjusted glyphs on both sides: a ligature may cover both, where Blink doesn\'t break, or a kern, where it may; Canvas totals don\'t show glyph clusters (shape_result.cc:684-694)'
const JOINING_LIGATURE_DETAIL = 'a chosen line edge between joining letters: a font\'s ligature may cover letters on both sides, where Blink doesn\'t break (shape_result.cc:684-694); Canvas totals don\'t show glyph clusters'
const IN_WORD_DETAIL = 'a line edge inside a word where the pair total shows no adjustment, so the port doesn\'t reshape: HarfBuzz can still flag the offset unsafe_to_break (contextual lookups, width-neutral flags) and Blink reshapes there (specs/blink-gaps.md §3.6 L2)'

const UNCERTAIN_LIGATURE_DETAIL = 'a ligature the font declaration lists as forming in some contexts only, on a line that can break between any two glyph clusters: Blink never breaks inside a glyph and gives its characters one position (shape_result.cc:684-694, 2113-2200), and whether the glyph forms here isn\'t known'

const TRUNCATED_START_DETAIL = 'a wrapped line start inside an RTL shaping run that the port\'s width tests call safe, in an item result the line cuts again at its trailing spaces: where HarfBuzz flags the start unsafe (contextual lookups and ligatures before it that change no width), Blink reshapes it, joins the reshape and the rest in one view whose parts it numbers in visual order, and the cut gives the first cluster\'s glyph to the part after it (shape_result_view.cc:215-308)'

const TRUNCATED_RESHAPE_DETAIL = 'a wrapped line start reshaped inside an RTL shaping run, in an item result the line cuts again at its trailing spaces: Blink reshapes up to the first offset HarfBuzz left safe, which can lie past the one the port\'s width tests find, numbers the view\'s parts in visual order, and the cut then keeps other glyphs than the port\'s view does (shape_result_view.cc:215-308, shaping_line_breaker.cc:309-324)'

const UNTESTED_END_DETAIL = 'a later break opportunity whose line-end reshape failed the fit test: every safe offset the port found between the line start and it is safe by the pair test alone, and where HarfBuzz flags them all (contextual lookups that change no width, as Shantell Sans\'s alternates do) Blink reshapes the whole range and takes the opportunity without a fit test (shaping_line_breaker.cc:497-506)'

const REQUEUED_SPACE_DETAIL = 'a line edge beside U+3000 where Canvas totals show an adjustment, in a font the declaration gives no coverage fact for: a font without U+3000 shapes its neighbours beside the space glyph HarfBuzz puts there, and Blink sends U+3000 itself to a fallback font (harfbuzz_shaper.cc:598-606), so the neighbour keeps its part of the kern, U+3000 none, and the offset is a run edge that is never reshaped; a font with U+3000 kerns it like any glyph'

const CLAMPED_START_DETAIL = 'a wrapped line start inside shaped text whose reshape alone takes the space left: ShapeLine adds the paragraph\'s width of the reshaped text to the space, less the reshape, and clamps the result at 0 (shaping_line_breaker.cc:309-324), where nothing fits and the line overflows at its first break; the paragraph\'s width there starts at a position the port takes from a Canvas stand-in'

const END_TEST_DETAIL = 'a break opportunity whose line-end reshape passed or failed the fit test by less than the rounding of the last safe offset\'s position: Blink reshapes from the last offset HarfBuzz left safe and tests the width after that position\'s ceiling (shaping_line_breaker.cc:543-553), HarfBuzz can flag offsets the port\'s width tests call safe (contextual lookups that change no width), and from an earlier safe offset the same glyphs pass or fail by another ceiling'

// The group whose text holds offset k strictly inside, or -1: the group of unit k, unless it starts there.
function groupAround(p: BlinkPrepared, k: number): number {
  const g = k < p.text.length ? p.groupOfUnit[k]! : -1
  return g >= 0 && p.groups[g]!.start < k ? g : -1
}

// Gaps at a line edge k inside a shaping group. `fromPosition`: the width there comes from the paragraph's position without
// a reshape at an unsafe offset (a wrapped line start's available-width correction, a line end before a space). `margin`:
// how many LayoutUnits the line's decision is from going the other way.
function edgeGap(gaps: GapAccumulator, sh: Shaper, k: number, fromPosition: boolean, margin: number, decided: { start: number; end: number } | null = null): void {
  const p = sh.p
  const g = groupAround(p, k)
  if (g < 0) return
  const group = p.groups[g]!
  const style = p.styles[group.style]!
  const run = runAt(p, k)
  const d = positionAdjust16(sh, g, k, group.start, group.end)
  const wide = adjust16(sh, g, k, group.start, group.end)
  const pair = pairAdjust16(sh, g, k, group.start, group.end)
  const at = sourceOffsetAt(p, k)
  // Beside U+3000 in a font that lacks it, k is a run edge, safe to break, and the cluster on its other side carries the
  // adjustment (shape.ts requeuedSpaceAt). Where the facts don't name that cluster's font, an adjustment there is placed by
  // the pairKerning rule, which is wrong if U+3000 went to a fallback font.
  switch (requeuedSpaceAt(p, k, group.start, group.end)) {
    case 'start': case 'end': return
    case 'unknown':
      if (pair !== 0) {
        addGap(gaps, 'font-fallback', run, REQUEUED_SPACE_DETAIL, clustersAround(p, k, group.start, group.end))
        return
      }
      break
    case null: break
  }
  // The shaping adjusted glyphs across the chosen edge: a ligature may merge the clusters on both sides into one glyph,
  // which Blink never breaks inside (OffsetToFit with BreakGlyphsOption(false), shape_result.cc:684-694; lam-alef in Apple
  // fonts, research/SUPERSET-blink.md §2.2 F), and Canvas totals can't tell a ligature from a kern (DESIGN.md §5
  // glyph-clusters). Letter spacing turns liga, clig and calt off in the DOM and in Canvas (font_features.cc:54-86): under
  // letter spacing no such ligature forms, and otherwise the pair window measured with a letter spacing that cancels out
  // shows whether the adjustment is a kern alone.
  // Where the declaration's ligature facts say no ligature covers k (ligatures.ts), what liga, clig and calt change there is
  // a contextual form, which no fact places.
  const ligatureFree = p.ligature[k] === LIGATURE_NONE
  const contextual = pair !== 0 && isClusterBoundary(p, k) && style.letterSpacing === 0 && pairAdjust16(sh, g, k, group.start, group.end, true) !== pair
  if (contextual && !ligatureFree) addGap(gaps, 'glyph-clusters', run, LIGATURE_DETAIL, at)
  // A joining edge is reshaped; the reshape's measurement reports joining-technology or unsafe-to-break. Joining letters
  // are where fonts form ligatures over several graphemes (lam-alef, the three-letter Allah ligature in Geeza Pro,
  // c-1c0b1895a5de8849), which the one-grapheme pair window can't see, and Blink never breaks inside one.
  if (joinsAcross(p, k, group.start, group.end)) {
    if (!ligatureFree) addGap(gaps, 'glyph-clusters', run, JOINING_LIGATURE_DETAIL, at)
    return
  }
  if (d !== 0 || wide !== 0) {
    // Which glyph carries the adjustment decides the position; FontFacts.pairKerning gives it for a kern between the two
    // clusters next to k, and nothing does for an adjustment that reads a longer context (positionAdjust16).
    if (fromPosition && (style.font.facts.pairKerning === null || pair !== wide || contextual)) addGap(gaps, 'unsafe-to-break', run, ATTRIBUTION_DETAIL, at)
    return
  }
  if (p.graphemeStarts[k] !== 1) return
  if (isSpaceLB(p.text.charCodeAt(k - 1)) || isSpaceLB(p.text.charCodeAt(k))) {
    // Beside a space Blink doesn't reshape a line end (dont_reshape_end_if_at_space, line_breaker.cc:255-268), but it
    // reshapes a wrapped line start that HarfBuzz flags, which it can with nothing the pair window shows (AAT state,
    // contextual lookups that change no width: Apple SD Gothic Neo's start after a space under -0.5px of word spacing,
    // DESIGN.md §4.6), and corrects the space by 0 or −1 LayoutUnits, which turns a fit decided by under two.
    if (decided !== null && margin < 2) addGap(gaps, 'in-word-prefix', run, ONE_UNIT_FIT_DETAIL, decided)
    return
  }
  // The pair window shows nothing across k, but HarfBuzz can still mark k unsafe to break (contextual lookups, width-neutral
  // flags), where Blink reshapes and the port doesn't.
  // - Where nothing interacts across k, the reshape's glyphs are the paragraph's and only rounding differs. At a line end
  //   Blink compares the reshape's width w after the last safe offset's ceiled position, ceil(p) + w, with the end position
  //   (shaping_line_breaker.cc:543-553), where the port compared ceil(p + w): less than one LayoutUnit apart. A wrapped line
  //   start corrects the available width by old_width − SnappedWidth (:309-324), which with equal glyphs is
  //   ceil(p1) − ceil(p0) − ceil(p1 − p0): 0 or −1. Both can act on one line, so the decision can go the other way only
  //   where the port's own margin, a whole number of LayoutUnits, is 0 or 1.
  //   The adjustment is taken over the whole measured piece around k (adjust16), so nothing the port can measure interacts
  //   across k here, at any distance.
  if (margin < 2) addGap(gaps, 'in-word-prefix', run, IN_WORD_DETAIL, at)
}

const ONE_UNIT_FIT_DETAIL = 'a wrapped line start beside a space that the port\'s width tests call safe, on a line whose fit test is decided by under two LayoutUnits (the line\'s end, or the end of the content that didn\'t fit, against the space it has plus one, line_breaker.cc CanFitOnLine): HarfBuzz can flag the start unsafe to break with no width signature (AAT state, contextual lookups that change no width), where Blink reshapes it and corrects the space by old_width − SnappedWidth, 0 or −1 LayoutUnits (shaping_line_breaker.cc:309-324), which moves the line\'s end against the space'

const START_REACH_DETAIL = 'a wrapped line start taken from a stand-in position, and the line\'s fit test decided within what that position can be off by: ShapeLine corrects the space a reshaped start leaves by the paragraph\'s width of the reshaped text, old_width − SnappedWidth (shaping_line_breaker.cc:309-324), which reads the start\'s position, so an adjustment there that no fact places (limits.ts positionLimit, positionBounds) moves the line\'s end against the space by as much'

// A wrapped line start's stand-in position: the condition it rests on and how many LayoutUnits the adjustment the port
// can't place spans (limits.ts positionBounds); null where the port knows the position or no adjustment shows.
function startSpread(sh: Shaper, k: number): { limit: GapName; units: number } | null {
  const p = sh.p
  const g = groupAround(p, k)
  if (g < 0) return null
  const group = p.groups[g]!
  const limit = positionLimit(sh, g, k, group.start, group.end)
  if (limit === null) return null
  const d = positionAdjust16(sh, g, clusterStartAtOrBefore(p, k, group.start), group.start, group.end)
  return d === 0 ? null : { limit, units: Math.ceil(Math.abs(d) / 1024) }
}

const ITEM_EDGE_DETAIL = 'an item edge inside a shaping call (a span edge between characters Blink shapes together): a glyph cluster over the edge goes to the item holding its first character (CopyRanges and FindGlyphDataRange, inline_node.cc:1781, glyph_data_range.cc:56-90), and item sizes are ceiled one by one, so the items around the edge, the x of the items after them and the line\'s width rest on a position the port doesn\'t know'

// A text item that starts inside its shaping group at an item edge takes its glyphs from the group's result by cluster. Where
// the port doesn't know the position of that edge (positionLimit), the line reports the condition over the clusters on both
// sides of it.
function itemEdgeGaps(gaps: GapAccumulator, sh: Shaper, info: LineInfo): void {
  const p = sh.p
  for (let i = 0; i < info.results.length; i++) {
    const r = info.results[i]!
    const item = p.items[r.itemIndex]!
    if (item.type !== 'text' || r.end === r.start || r.start !== item.start) continue
    const g = p.groupOfUnit[r.start]!
    const group = p.groups[g]!
    if (r.start <= group.start) continue
    const limit = positionLimit(sh, g, r.start, group.start, group.end)
    if (limit !== null) addGap(gaps, limit, runAt(p, r.start), ITEM_EDGE_DETAIL, clustersAround(p, r.start, group.start, group.end))
  }
}

function lineEdgeGaps(gaps: GapAccumulator, sh: Shaper, paragraph: readonly Gap[], info: LineInfo, start: BlinkLineStart): void {
  const p = sh.p
  // The break decision measured the content up to the next break opportunity after the line's end, the word that didn't
  // fit (ShapeLine's candidate offset lies before it, shaping_line_breaker.cc:421-480), so the content conditions there are
  // this line's too.
  const contentEnd = info.token === null ? p.text.length : info.token.textOffset
  if (info.decisionEnd > contentEnd) {
    const range = sourceRange(p, contentEnd, info.decisionEnd)
    const matches = p.inspect!.paragraphIndex!.intersect(range.start, range.end)
    for (const i of matches) {
      const g = paragraph[i]!
      addGap(gaps, g.gap, g.run, g.detail, g.at!)
    }
  }
  // How far the decision is from going the other way: the line's position against the fit bound (available width + 1,
  // line_breaker.cc CanFitOnLine), and, where the content that didn't fit sits in the same shaping group, its end against
  // the bound too.
  const bound = info.availableWidth + 1
  let margin = Math.abs(bound - info.unclampedWidth)
  if (info.decisionEnd > contentEnd) {
    const g = groupAround(p, contentEnd)
    if (g >= 0 && info.decisionEnd <= p.groups[g]!.end) {
      const extra = ceilFrom16(groupPrefix16(sh, g, info.decisionEnd) - groupPrefix16(sh, g, contentEnd))
      margin = Math.min(margin, Math.abs(info.unclampedWidth + extra - bound))
    }
  }
  // A wrapped line start's correction moves the whole line against its space, so where the line's fit lies within what the
  // correction can be off by, the start's condition reaches the line's end: it reports at the break the decision took, a
  // point, since the correction moves no glyph and the break is what it can get wrong (the observation port limits every
  // position a range meets, lab/observe/blink.ts). Where the start's position is a stand-in, by what the adjustment it
  // can't place spans; beside a space the port takes as safe, by a LayoutUnit (edgeGap).
  const wrapped = start.textOffset > 0 && !start.afterForcedBreak
  const decided = wrapped ? sourceOffsetAt(p, contentEnd) : null
  if (wrapped) {
    const spread = startSpread(sh, start.textOffset)
    if (spread !== null && margin < 2 + spread.units) addGap(gaps, spread.limit, runAt(p, start.textOffset), START_REACH_DETAIL, decided!)
  }
  // Positions inside a ligature over graphemes are what the decision reads at its candidate offset, where Blink gives every
  // character of a glyph the glyph's position (ComputePositionData, shape_result.cc:2113-2200) and the port Canvas prefixes:
  // ProbeShantell `ffiffl` natively fits `ffif` on the first line. So the content the decision measured past the line's end
  // reports glyph-clusters where a pair window there adjusts otherwise with liga, clig and calt off (font_features.cc:54-86).
  if (info.decisionEnd > contentEnd) {
    const g = groupAround(p, contentEnd) >= 0 ? groupAround(p, contentEnd) : groupAround(p, contentEnd + 1)
    const group = g >= 0 ? p.groups[g]! : null
    if (group !== null && p.styles[group.style]!.letterSpacing === 0) {
      const end = Math.min(info.decisionEnd, group.end)
      for (let k = Math.max(contentEnd, group.start + 1); k < end; k++) {
        // A boundary the ligature facts settle is predicted: a ligature's cluster takes one position, and none forms elsewhere.
        if (!isClusterBoundary(p, k) || p.ligature[k] === LIGATURE_NONE) continue
        const d = pairAdjust16(sh, g, k, group.start, group.end)
        if (pairAdjust16(sh, g, k, group.start, group.end, true) !== d) {
          addGap(gaps, 'glyph-clusters', runAt(p, k), LIGATURE_DETAIL, sourceOffsetAt(p, k))
          break
        }
      }
    }
  }
  // A listed ligature the facts don't settle (one that forms in some contexts only, ligatures.ts) inside what the decision
  // measured, on a line that may break between any two clusters: whether its letters are one glyph cluster decides where
  // such a break can fall and what the positions around it are (Courier New draws `لله` as one glyph after some letters:
  // c-06218d32a4b76797 keeps `له` together where natively every letter, reshaped alone, takes a line).
  if (info.breaksInsideWords) {
    for (let k = start.textOffset + 1; k < info.decisionEnd; k++) {
      if (p.ligature[k] === LIGATURE_UNCERTAIN) addGap(gaps, 'glyph-clusters', runAt(p, k), UNCERTAIN_LIGATURE_DETAIL, clustersAround(p, k, 0, p.text.length))
    }
  }
  // An opportunity the port gave up after its end reshape failed the fit test, which Blink takes untested where HarfBuzz
  // flags every offset before it (LineInfo.untestedEnds). A rewind can drop the item the opportunity was in, so only the
  // ones past the line's end count.
  for (let i = 0; i < info.untestedEnds.length; i++) {
    const end = info.untestedEnds[i]!
    if (end > contentEnd) addGap(gaps, 'in-word-prefix', runAt(p, contentEnd), UNTESTED_END_DETAIL, sourceRange(p, contentEnd, end))
  }
  // A wrapped line start whose reshape takes the whole space: whether ShapeLine clamps the corrected space rests on the
  // start's position, a stand-in (LineInfo.clampedStarts), and with it everything the line holds.
  for (let i = 0; i < info.clampedStarts.length; i++) {
    const clamped = info.clampedStarts[i]!
    if (clamped.start === start.textOffset) addGap(gaps, clamped.limit, runAt(p, clamped.start), CLAMPED_START_DETAIL, sourceRange(p, clamped.start, Math.max(contentEnd, clamped.start + 1)))
  }
  // A line-end fit test that another last safe offset could turn around (line-breaker.ts EndTest): an opportunity past the
  // line's end that the port gave up, or the one the line ends at.
  let lineEnd = -1
  for (let i = info.results.length - 1; i >= 0 && lineEnd < 0; i--) {
    const r = info.results[i]!
    if (p.items[r.itemIndex]!.type === 'text' && r.shape !== null && !r.hasOnlyPreWrapTrailingSpaces) lineEnd = r.trimmedEnd ?? r.end
  }
  for (let i = 0; i < info.endTests.length; i++) {
    const test = info.endTests[i]!
    if (!test.fits && test.offset > contentEnd) addGap(gaps, 'in-word-prefix', runAt(p, contentEnd), END_TEST_DETAIL, sourceRange(p, contentEnd, test.offset))
    // A rewind can drop the item a test was in: only the test of the end the line kept counts.
    if (test.fits && test.offset === lineEnd && test.from >= start.textOffset && test.from < test.offset) {
      addGap(gaps, 'in-word-prefix', runAt(p, test.from), END_TEST_DETAIL, sourceRange(p, test.from, test.offset))
    }
  }
  // A wrapped line start inside an RTL shaping run that the port's tests call safe, in an item result the line cut again:
  // where HarfBuzz flags the start, Blink's view joins the reshaped start and the rest, numbers its parts in visual order,
  // and the later cut gives the first letter's glyph to the part after it (shape_result_view.cc:215-308, class 3 of
  // specs/blink-RESULTS.md). Natively `ك` before a trimmed space is 0 wide at such a start after Geeza Pro's lam-alef, which
  // the pair and wide windows call safe (fresh set r3-blink-4, c-a7d036caa5cf8f42).
  if (start.textOffset > 0 && !start.afterForcedBreak && info.truncatedStarts.includes(start.textOffset)) {
    const k = start.textOffset
    const g = groupAround(p, k)
    const first = info.results.find(r => r.start === k && r.shape !== null)
    if (g >= 0 && p.groups[g]!.rtl && !isSegmentEdge(p, k) && first !== undefined && viewPartCount(first.shape!) > 0 && viewPartAt(first.shape!, 0).kind === 'range') {
      let b = k + 1
      while (b < p.groups[g]!.end && !isClusterBoundary(p, b)) b++
      addGap(gaps, 'in-word-prefix', runAt(p, k), TRUNCATED_START_DETAIL, sourceRange(p, k, b))
    }
    // The same cut where the port reshaped the start: the reshape ends at the port's first safe offset, which HarfBuzz may
    // flag. A longer reshape numbers the parts otherwise, and the cut keeps other glyphs: natively `حين. ` in Geeza Pro is
    // reshaped to the item's end and keeps `ن`, where the port's reshape of `حين` alone loses it with the space
    // (c-a3b5719bcaf20813: 3762 units natively, 2533 predicted). Known only where the reshape ends at a run's first glyph
    // or at the item's end.
    const head = first === undefined || viewPartCount(first.shape!) === 0 ? null : viewPartAt(first.shape!, 0)
    if (g >= 0 && p.groups[g]!.rtl && first !== undefined && head !== null && head.kind === 'reshape' && viewPartCount(first.shape!) > 1) {
      const end = head.call.end
      const itemEnd = p.items[first.itemIndex]!.end
      if (end < itemEnd && !isSegmentEdge(p, end) && !isFontRunEdge(p, end, p.groups[g]!.start, p.groups[g]!.end)) {
        addGap(gaps, 'in-word-prefix', runAt(p, k), TRUNCATED_RESHAPE_DETAIL, sourceRange(p, k, first.trimmedEnd ?? first.end))
      }
    }
  }
  // A wrapped line start: ShapeLine reshapes [start, first safe) and corrects the available width by the paragraph's
  // positions (shaping_line_breaker.cc:309-324).
  if (wrapped) edgeGap(gaps, sh, start.textOffset, true, margin, decided)
  // The end, the paragraph's last line included: a line ending before hanging or trimmed spaces takes its width there.
  // Preserved trailing spaces the line's width holds end at the paragraph position after them, whose adjustment with what
  // follows sits on their last glyph (c-05bd16ecf8949f4c: `xx ` before `AAAA` in Times New Roman).
  let spacesEnd = -1
  for (let i = info.results.length - 1; i >= 0; i--) {
    const r = info.results[i]!
    if (p.items[r.itemIndex]!.type !== 'text' || r.end === r.start) continue
    if (spacesEnd < 0) spacesEnd = r.end
    if (r.hasOnlyPreWrapTrailingSpaces) continue
    let k = r.end
    while (k > r.start && isSpaceLB(p.text.charCodeAt(k - 1))) k--
    // A line end before a space isn't reshaped (dont_reshape_end_if_at_space, line_breaker.cc:255-268) unless the line
    // needs an accurate end position.
    edgeGap(gaps, sh, k, isSpaceLB(p.text.charCodeAt(k)) && !info.needsAccurateEndPosition, margin)
    if (k < spacesEnd && (isSpaceLB(p.text.charCodeAt(spacesEnd - 1)) || p.text.charCodeAt(spacesEnd - 1) === 0x3000)) edgeGap(gaps, sh, spacesEnd, true, margin)
    return
  }
}

// The gaps a decided line's breaks rest on, in the order they were raised: the ones its filling raised, across every pass
// of the fill, then the ones of its edges and of its item edges. A new list with entries of its own, which whatever
// inspects the line's geometry goes on raising into (inspect.ts), so the decided line stays as the fill left it.
export function lineGaps(p: BlinkPrepared, line: { info: LineInfo; start: BlinkLineStart; gaps: Gap[] | null }): GapAccumulator {
  const paragraph = inspected(p, 'inspectLine').gaps
  if (line.gaps === null) throw new Error('inspectLine reads a line filled from an inspected paragraph, and this one was filled plain')
  const gaps = new GapAccumulator(p.index.text.length, line.gaps)
  const sh: Shaper = { p, gaps }
  lineEdgeGaps(gaps, sh, paragraph, line.info, line.start)
  itemEdgeGaps(gaps, sh, line.info)
  return gaps
}
