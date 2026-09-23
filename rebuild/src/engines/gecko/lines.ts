// Line filling for Gecko (Firefox 156.0): nsBlockFrame::ReflowInlineFrames with at most one redo, nsLineLayout's per-span
// line data (BeginSpan, EndSpan), ReflowFrame, CanPlaceFrame, PlaceFrame and NotifyOptionalBreakPosition,
// nsInlineFrame::ReflowFrames, nsTextFrame::ReflowText and gfxTextRun::BreakAndMeasureText. specs/gecko-lines.md §4; widths
// are integer app units throughout (§2.8). A fill decides where the line breaks and leaves the frames its last pass placed
// (GeckoFilledLine); placing them, the line's pieces and its inspection are read from that record (placement.ts, pieces.ts,
// inspect.ts), and nothing writes it after the fill.
import type { FillResultOf, Gap, LineSlot, RangeFillResultOf } from '../../model.js'
import { advanceBefore, advancesAreSuffixes, codePointAtT, groupAround } from './advance.js'
import * as gaps from './gaps.js'
import type { GeckoLineStart } from './geometry.js'
import { BREAK_EMERGENCY_WRAP, BREAK_NORMAL } from './linebreak.js'
import { isTrimmableChar, pxToAu } from './prepare.js'
import { isBidiControl, isClusterExtenderExcludingJoiners, isCursiveScript } from './props.js'
import {
  KIND_NEWLINE, KIND_TAB, NORMAL_BREAK, NO_BREAK, WORD_WRAP_BREAK, objectAt, spanAt, type GeckoEdgeItem, type GeckoObjectItem, type GeckoPrepared,
  type GeckoTextRun, type InWordAdvance,
} from './types.js'

const SHY = 0x00ad
// The offset NotifyOptionalBreakPosition takes for "after the content" of a frame that isn't text (nsLineLayout.cpp:1057-1066).
const AFTER_CONTENT = 0x7fffffff

// The glyph advance before t. `consulted` is the list of the fill whose breaks read it, which takes t where Canvas can't
// confirm the advance, a transformed offset (the line reports those that decide it, gaps.ts lineGaps); null on a plain
// paragraph, and where the advance only places a decided line.
function glyphBefore(p: GeckoPrepared, run: GeckoTextRun, t: number, consulted: number[] | null): number {
  const value = advanceBefore(p, run, t)
  if (consulted !== null && value.standIn !== null) consulted.push(t)
  return value.au
}

// A frame's measuring context: nsTextFrame::PropertyProvider (nsTextFrame.cpp:3472-3500) with its tab widths.
export type Provider = {
  run: GeckoTextRun
  frame: number
  // Source offset and length of the measured content (after leading white space was skipped).
  start: number
  length: number
  startT: number
  startOfLine: boolean
  letterSpacingAu: number
  // The tabs of the measured content in text order (computeTabs); none in a text run without a tab.
  tabs: readonly Tab[]
}

// A tab's transformed index and width, and why the width is a stand-in where it is one; never on a plain paragraph.
export type Tab = { t: number; width: number; standIn: gaps.TabReason | null }
const NO_TABS: readonly Tab[] = []

// The widths of the frame's tabs in [a, b).
function tabsIn(prov: Provider, a: number, b: number): number {
  let w = 0
  let lo = 0, hi = prov.tabs.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (prov.tabs[mid]!.t < a) lo = mid + 1
    else hi = mid
  }
  for (let k = lo; k < prov.tabs.length && prov.tabs[k]!.t < b; k++) w += prov.tabs[k]!.width
  return w
}

// The letter and word spacing of [a, b) as the frame's measured ranges get it: the paragraph's spacing (prepare.ts step 6),
// and one more rule that needs the frame. A range that starts inside a ligature group measures its part of the group apart,
// and where the part reaches the group's end it asks the spacing after the group's last character for that character alone
// (ComputeLigatureData, gfxTextRun.cpp:306-320; BreakAndMeasureText and MeasureText both go through it, :809-836,
// :989-1000). GetSpacingInternal looks for the cluster's base no further back than the range it was asked for
// (FindClusterStart from run.GetOriginalOffset(), nsTextFrame.cpp:3549-3560, :4203-4213), so a mark that ends the group is
// its own base, and a mark of script Inherited isn't cursive: the group takes the letter spacing its cursive letter
// wouldn't. Fresh c-66f10943bae83d88: a span starts at the second lam of lam lam-shadda-fatha heh-kasra in 16px "Geeza Pro"
// under 5px of letter spacing, one ligature group, and the kasra's part is 523 au, its 223 au share and 300 au.
export function spacingIn(p: GeckoPrepared, prov: Provider, a: number, b: number, scan = false): number {
  const spacing = scan ? p.scanSpacingPrefix[b]! - p.scanSpacingPrefix[a]! : p.spacingPrefix[b]! - p.spacingPrefix[a]!
  const extra = groupEndSpacing(p, prov)
  return extra !== null && a <= extra.at && extra.at < b ? spacing + extra.au : spacing
}

// Where the frame's measured ranges take that spacing, and how much: read each time from the group at the frame's start,
// which its unit keeps once Canvas has shown it (types.ts InWordEntry).
function groupEndSpacing(p: GeckoPrepared, prov: Provider): { at: number; au: number } | null {
  const from = prov.startT
  if (prov.letterSpacingAu === 0 || from >= prov.run.tEnd || p.clusterStart[from] === 0) return null
  const unit = p.units[p.unitOf[from]!]!
  const group = from > unit.tStart ? groupAround(p, prov.run, unit, from) : null
  const f = p.frames[prov.frame]!
  if (group !== null && !group.unconfirmed && group.end <= f.tEnd && p.spacingPrefix[group.end] === p.spacingPrefix[group.end - 1] &&
    !isCursiveScript(codePointAtT(p, group.end - 1))) {
    return { at: group.end - 1, au: prov.letterSpacingAu }
  }
  return null
}

// GetAdvanceWidth and MeasureText: partial ligature shares at the range ends (gfxTextRun.cpp:238-329, :1195, :1214-1256).
export function rangeAdvance(p: GeckoPrepared, prov: Provider, a: number, b: number, consulted: number[] | null): number {
  if (b <= a) return 0
  return glyphBefore(p, prov.run, b, consulted) - glyphBefore(p, prov.run, a, consulted) + spacingIn(p, prov, a, b) + tabsIn(prov, a, b)
}

// BreakAndMeasureText's running width: GetAdvanceForGlyph per character, a ligature group's whole advance on its first
// character, with spacing and tabs; only a group that reaches past an end of the scanned range [from, to) goes by shares
// (the ligature range, gfxTextRun.cpp:989-1000, :1139-1159). So a position inside a group that lies within the range
// counts the whole group (policy c-5ba3b0da55cb63ad: after alef, 16px Geeza Pro's lam lam heh scans as 669 au at once and
// goes to the next line; fresh c-ca72eae85de1aead: a span holding lam alone scans it as its 280 au share of lam-alef).
function scanAdvance(p: GeckoPrepared, prov: Provider, from: number, to: number, a: number, b: number, consulted: number[] | null): number {
  if (b <= a) return 0
  const end = glyphBefore(p, prov.run, scanOffset(p, prov, from, to, b), consulted)
  const start = glyphBefore(p, prov.run, scanOffset(p, prov, from, to, a), consulted)
  return end - start + spacingIn(p, prov, a, b, true) + tabsIn(prov, a, b)
}

// The offset whose advance stands for position t in a scan of [from, to): the end of a ligature group that lies within the
// range and spans t, else t.
function scanOffset(p: GeckoPrepared, prov: Provider, from: number, to: number, t: number): number {
  if (t < prov.run.tEnd && p.clusterStart[t] === 1) {
    const unit = p.units[p.unitOf[t]!]!
    if (t > unit.tStart) {
      const group = groupAround(p, prov.run, unit, t)
      if (group !== null && group.start >= from && group.end <= to) return group.end
    }
  }
  return t
}

// CalcTabWidths and AdvanceToNextTab (nsTextFrame.cpp:4298-4378): tab stops from the block's content edge. The position
// it tracks isn't the frame's measured advance:
// - A character adds its cluster's glyph advance only where it starts a cluster (:4349-4357), so the characters a frame
//   starts with inside a cluster (a span that starts at a mark, a mark after a tab) add nothing, though the frame's width
//   holds their part. Fresh c-552fa9e3eb8a2096: a span starts at U+094B inside the cluster of U+0926 in 20px "Kohinoor
//   Devanagari" and holds a tab; natively the mark's part is 328 au, the tab ends at 7456 au of tracked position, twice the
//   3728 au tab width, and at 7784 au on the line.
// - Spacing is asked for one character at a time (:4345-4347), so the base a cluster's letter spacing goes by is the
//   character itself (p.tabs.spacingPrefix, prepare.ts step 6).
// A tab's width is the next stop less that position, so it is a stand-in where the position is one: where an earlier text
// frame of the line has a stand-in width, or the first cluster the scan counts starts at a stand-in. Those tabs hold the
// reason (gaps.ts placedStandIn, tabCountsFrom). A later tab counts from the stop before it; it stays a stand-in, since a
// stand-in that crosses a stop moves every stop after it. The tabs of text run `run` in [startT, end), the measured content
// of frame `frame`.
function computeTabs(p: GeckoPrepared, ll: LineLayout, run: GeckoTextRun, frame: number, startT: number, end: number, psd: SpanData):
  { tabs: readonly Tab[]; through: (until: number) => void } | null {
  if (p.tabs === null || !run.hasTab) return null
  // rule gecko/measure/tab-width-containing-block
  // ComputeTabWidthAppUnits (nsTextFrame.cpp:3875-3906): tab-size is the text frame's own (aFrame->StyleText()->mTabSize);
  // the space, the letter spacing and the word spacing are the containing block's (rich-prewrap/tabs c-07ac640c4ed9f71f:
  // a span with tab-size 12 in a block with tab-size 3).
  const tabWidth = p.leaves[p.frames[frame]!.run]!.style.tabSize * p.tabs.unit
  // GetSpacing calls CalcTabWidths only for a positive tab width (nsTextFrame.cpp:4306-4309): tab-size 0, or letter
  // spacing below minus the space width, leaves tabs at 0.
  if (tabWidth <= 0) return null
  const tabs: Tab[] = []
  const tabSpacing = p.tabs.spacingPrefix
  let x = 0
  let started = false
  const prefix = ll.tabPrefix
  if (prefix !== null && prefix.reason === null) {
    prefix.reason = gaps.placedStandIn(ll.gaps, p, ll.root, prefix.through)
    prefix.through = ll.root.frames.length
  }
  let standIn = prefix?.reason ?? null
  let from = startT
  const positions = p.tabs.positions
  let lo = 0, hi = positions.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (positions[mid]! < startT) lo = mid + 1
    else hi = mid
  }
  let next = lo
  // The break scan asks ranges in order. Materialize only their tabs; a narrow first line must not build every tab
  // in the frame's unconsumed suffix. This builder ends with reflow; the decided line holds only its tab records.
  const through = (until: number): void => {
    const limit = Math.min(until, end)
    while (next < positions.length && positions[next]! < limit) {
      const t = positions[next++]!
      if (!started) {
        // The containing coordinates are unchanged until this text frame finishes reflow. Add them in the original
        // innermost-to-root order only when a consumed tab actually needs the origin.
        for (let s: SpanData | null = psd; s !== null; s = s.parent) x += s.iCoord
        started = true
      }
      let first = from
      while (first < t && p.clusterStart[first] === 0) first++
      standIn = gaps.tabCountsFrom(ll.gaps, standIn, p, run, first)
      x += glyphBefore(p, run, t, ll.consulted) - glyphBefore(p, run, first, ll.consulted) + tabSpacing[t]! - tabSpacing[from]!
      const nextTab = Math.ceil((x + run.minTabAdvance) / tabWidth) * tabWidth
      const w = Math.trunc(nextTab - x + (nextTab - x >= 0 ? 0.5 : -0.5)) // NSToIntRound
      tabs.push({ t, width: w, standIn })
      x = nextTab + tabSpacing[t + 1]! - tabSpacing[t]!
      from = t + 1
    }
  }
  return { tabs, through }
}

// GetHyphenationBreaks (nsTextFrame.cpp:4409-4457): a soft opportunity before the first kept character after skipped
// characters ending in SHY, inside this frame's measured content, not at the frame start of a line-starting frame, and
// only where the frame's white-space wraps.
function hyphenSoft(p: GeckoPrepared, prov: Provider, t: number): boolean {
  if (!p.leaves[p.frames[prov.frame]!.run]!.style.wrap) return false
  const s = p.tSource[t]! - 1
  if (s < prov.start || s >= prov.start + prov.length || p.text.charCodeAt(s) !== SHY) return false
  return !prov.startOfLine || t > prov.startT
}

export type Measured = {
  charsFit: number
  advance: number
  trimmableChars: number
  trimmableAdvance: number
  usedHyphenation: boolean
  // aLastBreak, from aStart: given only where everything fit and a break was seen (UINT32_MAX otherwise).
  lastBreak: number | null
  breakPriority: number
}

// The glyph advance before a shaping unit's start, or the run's end: what advanceBefore gives there, read from the units'
// running sum, which asks Canvas nothing.
function unitStartAdvance(p: GeckoPrepared, run: GeckoTextRun, t: number): number {
  return t >= run.tEnd ? run.totalAdvance : p.units[p.unitOf[t]!]!.startAdvance
}

// scanAdvance (`scan`) or rangeAdvance from a to b where both start a unit.
function unitsAdvance(p: GeckoPrepared, prov: Provider, a: number, b: number, scan: boolean): number {
  return unitStartAdvance(p, prov.run, b) - unitStartAdvance(p, prov.run, a) + spacingIn(p, prov, a, b, scan) + tabsIn(prov, a, b)
}

const startsUnit = (p: GeckoPrepared, run: GeckoTextRun, t: number): boolean => t >= run.tEnd || p.units[p.unitOf[t]!]!.tStart === t

// BreakAndMeasureText decided from the shaping units' advances alone: the same loop, walked unit by unit; null where it
// can't be, and the engine's loop decides (charScan). Gecko shapes a text run word by word (gfxFont::SplitAndInitTextRun,
// gfxFont.cpp:3708-3900: a boundary space is a glyph of its own and nothing is shaped across it), so the advance before
// a unit's start is the sum of the units before it, which `prepare` measured, and a candidate there asks Canvas nothing.
// The loop's state at such a candidate is a function of those sums: its running width is the advance from aStart (the
// pending advances telescope), its trimmable advance the run of spaces before it, and without a soft hyphen the test
// that accepts a candidate and the test that aborts the scan are one (gfxTextRun.cpp:1090-1108), so the scan ends at the
// first candidate that doesn't fit. What can't be decided here:
// - a scan that starts or ends inside a unit, or trims from inside one, reads an advance inside a unit;
// - break-spaces adds candidates this walk doesn't list (:1076-1082), and so does a unit that a removed soft hyphen
//   stands in or before, where the walk stops: a hyphenation break tests the fit with the hyphen's width and aborts
//   without it. A soft hyphen after the scan's end is reached by neither scan.
// A unit can hold candidates inside itself: natural breaks (after a hyphen, between Han characters), and while no normal
// break was accepted every cluster start under overflow-wrap, or the emergency break after a hyphen (:1068-1073). Their
// advances are Canvas questions, four to five a cluster. The walk passes over them where the unit's end fits, on a
// PREMISE about fonts that no engine source gives and Canvas isn't asked for (DESIGN.md §4.6, "Gecko's word scan"): the
// advance before an offset inside a word is never more than the advance before the word's end, so no tail of a shaped
// word has a negative advance (a detailed glyph's advance is signed and nothing clamps it, gfxHarfBuzzShaper.cpp:1692-1721).
// It held in every installed face checked. Then every inner candidate fits, none aborts, and the last of them is the
// scan's last break until a later candidate is accepted; a scan that would break at it is left to the loop, since the
// edge's advance is asked of Canvas. Letter spacing, negative word spacing and a trimmable space inside the unit would
// enter the inner tests, so they leave it to the loop, and so does a unit whose inner advances the port takes from a
// prefix's width (advance.ts advancesAreSuffixes): what is left of the premise is that Canvas measures no suffix below
// nothing and no suffix narrower than the share of a pair's adjustment it holds. An inspected paragraph holds each scan
// decided here against the loop (breakAndMeasureText).
function wordScan(p: GeckoPrepared, prov: Provider, aStart: number, aMaxLength: number, aWidth: number, suppress: 'none' | 'initial',
  canWordWrap: boolean, canWhitespaceWrap: boolean, isBreakSpaces: boolean, wantTrimmable: boolean, priorityIn: number): Measured | null {
  const run = prov.run
  const end = aStart + aMaxLength
  if (isBreakSpaces || !startsUnit(p, run, aStart) || !startsUnit(p, run, end)) return null
  let breakPriority = priorityIn
  let lastBreak = -1
  // Whether the last break is a passed unit's last inner candidate.
  let lastBreakInside = false
  let lbChars = 0
  let lbAdvance = 0
  let aborted = false
  for (let k = aStart < end ? p.unitOf[aStart]! : p.units.length; k < p.units.length && p.units[k]!.tStart < end; k++) {
    const unit = p.units[k]!
    const t = unit.tStart
    if (run.hasShy) for (let i = t; i < unit.tEnd; i++) if (p.tSource[i]! > 0 && p.text.charCodeAt(p.tSource[i]! - 1) === SHY) return null
    if (t > aStart || suppress === 'none') {
      const atBreak = p.breakFlags[t] === BREAK_NORMAL
      const wordWrapping = (canWordWrap || (canWhitespaceWrap && p.breakFlags[t] === BREAK_EMERGENCY_WRAP)) && p.clusterStart[t] === 1 &&
        breakPriority <= WORD_WRAP_BREAK
      if (atBreak || wordWrapping) {
        let trimStart = t
        if (wantTrimmable) while (trimStart > aStart && p.isSpace[trimStart - 1] === 1) trimStart--
        if (!startsUnit(p, run, trimStart)) return null
        const trimmableAdvance = unitsAdvance(p, prov, trimStart, t, true)
        const fits = unitsAdvance(p, prov, aStart, t, true) - trimmableAdvance <= aWidth
        if (lastBreak < 0 || fits) {
          lastBreak = t
          lastBreakInside = false
          lbChars = t - trimStart
          lbAdvance = trimmableAdvance
          breakPriority = atBreak ? NORMAL_BREAK : WORD_WRAP_BREAK
        }
        if (!fits) {
          aborted = true
          break
        }
      }
    }
    // What the unit holds after its first character: a natural break, a cluster start that word wrapping takes while
    // it lasts, a trimmable space (U+3000, or a space before a cluster extender).
    let natural = -1
    let wrapping = -1
    let space = p.isSpace[t] === 1
    for (let i = t + 1; i < unit.tEnd; i++) {
      if (p.breakFlags[i] === BREAK_NORMAL) natural = i
      if (p.clusterStart[i] === 1 && (canWordWrap || (canWhitespaceWrap && p.breakFlags[i] === BREAK_EMERGENCY_WRAP))) wrapping = i
      if (p.isSpace[i] === 1) space = true
    }
    if (natural >= 0 || (wrapping >= 0 && breakPriority <= WORD_WRAP_BREAK)) {
      // The loop adds each character's spacing to its advance (gfxTextRun.cpp:1139-1151), so an inner candidate fits where
      // the unit's end does only if no suffix of the unit holds negative spacing. A word holds word spacing where a space
      // is no boundary: U+0020 or U+00A0 before a join control (IsBoundarySpace refuses a space before any cluster
      // extender, gfxFont.cpp:3317-3323; word spacing goes to a space unless a combining sequence tail follows, which
      // leaves the join controls out, nsTextFrame.cpp:879-898, :4215-4225, nsTextFrameUtils.cpp:24-30), and U+00A0 isn't
      // trimmable (nsTextFrame.cpp:904-913). Without letter spacing every character of a frame takes the frame's one
      // word spacing or none, so the unit's spacing is negative exactly where a suffix's is.
      if (prov.letterSpacingAu !== 0 || space || p.scanSpacingPrefix[unit.tEnd]! < p.scanSpacingPrefix[t]! ||
        unitsAdvance(p, prov, aStart, unit.tEnd, true) > aWidth || !advancesAreSuffixes(p, unit)) return null
      // The first natural break ends word wrapping, so the last candidate accepted is the last natural break where
      // the unit has one.
      lastBreak = natural >= 0 ? natural : wrapping
      lastBreakInside = true
      lbChars = 0
      lbAdvance = 0
      breakPriority = natural >= 0 ? NORMAL_BREAK : WORD_WRAP_BREAK
    }
  }
  let charsFit = -1
  let trimmableChars = 0
  let trimmableAdvance = 0
  if (!aborted) {
    let trimStart = end
    if (wantTrimmable) while (trimStart > aStart && p.isSpace[trimStart - 1] === 1) trimStart--
    if (!startsUnit(p, run, trimStart)) return null
    trimmableChars = end - trimStart
    trimmableAdvance = unitsAdvance(p, prov, trimStart, end, true)
    if (unitsAdvance(p, prov, aStart, end, true) - trimmableAdvance <= aWidth || lastBreak < 0) charsFit = aMaxLength
  }
  if (charsFit < 0) {
    if (lastBreakInside) return null
    charsFit = lastBreak - aStart
    trimmableChars = lbChars
    trimmableAdvance = lbAdvance
  }
  return {
    charsFit, advance: unitsAdvance(p, prov, aStart, aStart + charsFit, false), trimmableChars, trimmableAdvance, usedHyphenation: false,
    lastBreak: charsFit === aMaxLength && lastBreak >= 0 ? lastBreak - aStart : null, breakPriority,
  }
}

// gfxTextRun::BreakAndMeasureText: the word scan where it decides, else the engine's loop. A text run with a tab goes to the
// loop, which asks for the tabs' widths as it reaches them (computeTabs). An inspected paragraph runs the loop first, so it
// asks Canvas what it always asked, and reports where the word scan decides otherwise (gaps.ts negativeWordTail); the line
// is the word scan's in both modes.
function breakAndMeasureText(p: GeckoPrepared, prov: Provider, aStart: number, aMaxLength: number,
  aWidth: number, suppress: 'none' | 'initial', canWordWrap: boolean, canWhitespaceWrap: boolean, isBreakSpaces: boolean,
  wantTrimmable: boolean, priorityIn: number, sink: gaps.GapSink, consulted: number[] | null, tabsThrough: ((until: number) => void) | null): Measured {
  aMaxLength = Math.min(aMaxLength, prov.run.tEnd - aStart)
  const loop = sink === null ? null
    : charScan(p, prov, aStart, aMaxLength, aWidth, suppress, canWordWrap, canWhitespaceWrap, isBreakSpaces, wantTrimmable, priorityIn, consulted, tabsThrough)
  const word = prov.run.hasTab ? null : wordScan(p, prov, aStart, aMaxLength, aWidth, suppress, canWordWrap, canWhitespaceWrap, isBreakSpaces, wantTrimmable, priorityIn)
  if (word === null) return loop ?? charScan(p, prov, aStart, aMaxLength, aWidth, suppress, canWordWrap, canWhitespaceWrap, isBreakSpaces, wantTrimmable, priorityIn, consulted, tabsThrough)
  gaps.negativeWordTail(sink, p, p.frames[prov.frame]!.run, aStart, loop, word)
  return word
}

// The engine's loop: gfxTextRun::BreakAndMeasureText (gfxTextRun.cpp:922-1212), hyphens manual.
function charScan(p: GeckoPrepared, prov: Provider, aStart: number, aMaxLength: number,
  aWidth: number, suppress: 'none' | 'initial', canWordWrap: boolean, canWhitespaceWrap: boolean, isBreakSpaces: boolean,
  wantTrimmable: boolean, priorityIn: number, consulted: number[] | null, tabsThrough: ((until: number) => void) | null): Measured {
  const run = prov.run
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
  // Adjacent pending intervals have the same provider and scan bounds for this one traversal. Keep the endpoint
  // already discovered by the preceding interval; trim queries remain arbitrary ranges. The first interval still
  // discovers its end before its start, and every logical glyph read preserves its inspection observation.
  let pendingGlyph: InWordAdvance | null = null
  let pendingGlyphAt = -1
  const pendingAdvanceTo = (until: number): number => {
    if (until <= pending) return 0
    const endAt = scanOffset(p, prov, aStart, end, until)
    const endGlyph = advanceBefore(p, run, endAt)
    if (consulted !== null && endGlyph.standIn !== null) consulted.push(endAt)
    const endAdvance = endGlyph.au
    let startAdvance: number
    if (pendingGlyph === null) startAdvance = glyphBefore(p, run, scanOffset(p, prov, aStart, end, pending), consulted)
    else {
      if (consulted !== null && pendingGlyph.standIn !== null) consulted.push(pendingGlyphAt)
      startAdvance = pendingGlyph.au
    }
    pendingGlyph = endGlyph
    pendingGlyphAt = endAt
    return endAdvance - startAdvance + spacingIn(p, prov, pending, until, true) + tabsIn(prov, pending, until)
  }
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
        tabsThrough?.(i)
        const pendingAdvance = pendingAdvanceTo(i)
        const trimmableAdvance = trimmableChars > 0 ? scanAdvance(p, prov, aStart, end, trimStart, i, consulted) : 0
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
  if (!aborted) {
    tabsThrough?.(end)
    width += pendingAdvanceTo(end)
  }
  let trimmableAdvance = trimmableChars > 0 ? scanAdvance(p, prov, aStart, end, trimStart, scanEnd, consulted) : 0
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
    charsFit, advance: rangeAdvance(p, prov, aStart, aStart + charsFit, consulted), trimmableChars, trimmableAdvance, usedHyphenation,
    lastBreak: charsFit === aMaxLength && lastBreak >= 0 ? lastBreak - aStart : null, breakPriority,
  }
}

// A saved or forced break position: the frame (an item index plus, for a text continuation, its content start) and the
// offset, relative to the frame's measured start for text, AFTER_CONTENT after another frame, 0 before the line's first frame.
type BreakPosition = { item: number; contentStart: number; offset: number }

// nsLineLayout::PerSpanData (nsLineLayout.h), in the span's own coordinates: the root span from the band's start, a child
// span from its frame's border-box start.
export type SpanData = {
  element: number
  iStart: number
  iCoord: number
  iEnd: number
  noWrap: boolean
  frames: Reflowed[]
  hasNonemptyContent: boolean
  parent: SpanData | null
}

// nsLineLayout::PerFrameData for each frame a pass placed: its inline start in its span's coordinates after the start
// margin, and its inline size. Reflow leaves a text frame untrimmed and every frame without justification gaps; placing a
// decided line makes records of its own for what it writes (placement.ts).
export type ReflowedText = { kind: 'text'; item: number; r: FrameResult; iStart: number; iSize: number }
// `hasStartEdge`: the frame has no previous continuation, from an earlier line or a bidi split; `hasEndEdge`: no next one.
export type ReflowedSpan = { kind: 'span'; element: number; span: SpanData; iStart: number; iSize: number; hasStartEdge: boolean; hasEndEdge: boolean }
export type ReflowedLeaf = { kind: 'atomic' | 'br' | 'wbr'; element: number; iStart: number; iSize: number; startMargin: number; endMargin: number }
export type Reflowed = ReflowedText | ReflowedSpan | ReflowedLeaf

// nsLineLayout's state over one pass.
type LineLayout = {
  // Where the pass's gaps go, and where the in-word stand-in offsets its break scans consult (glyphBefore): the two lists
  // of the fill's record (GeckoLineInspect); null on a plain paragraph.
  gaps: gaps.GapSink
  consulted: number[] | null
  root: SpanData
  // Frames are retained only for a full line output or inspected decisions (tab stand-ins read them).
  recordFrames: boolean
  // Completed root frames form an append-only prefix in this one speculative pass. A redo owns fresh state.
  tabPrefix: { through: number; reason: gaps.TabReason | null } | null
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

export type FrameResult = {
  frame: number
  // The content the frame takes, [contentStart, contentStart + contentLength), measured from `offset` after the line-start
  // skip of trimmable white space.
  contentStart: number
  offset: number
  contentLength: number
  // The transformed index where the frame's content ends.
  tEnd: number
  width: number
  nonEmpty: boolean
  usedHyphenation: boolean
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
export type Justification = { inner: number; startJustifiable: boolean; endJustifiable: boolean }
// JustificationAssignment: gaps at a frame's or character's sides.
export type Assignment = { start: number; end: number }
export const NO_JUSTIFICATION: Justification = { inner: 0, startJustifiable: false, endJustifiable: false }

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
export function computeJustification(p: GeckoPrepared, frame: number, rangeStart: number, rangeEnd: number): { info: Justification; assignments: Assignment[] } {
  const f = p.frames[frame]!
  const leaf = p.leaves[f.run]!
  const style = leaf.style
  const lang = leaf.language.tag.toLowerCase()
  const cj = lang === 'ja' || lang === 'zh' || lang.startsWith('ja-') || lang.startsWith('zh-') // IsChineseOrJapanese, :3441-3454
  const arrayStart = Math.min(p.nextT[rangeStart]!, f.tEnd)
  const tEnd = Math.min(p.nextT[rangeEnd]!, f.tEnd)
  const assignments: Assignment[] = []
  for (let t = arrayStart; t < tEnd; t++) assignments.push({ start: 0, end: 0 })
  const info: Justification = { inner: 0, startJustifiable: false, endJustifiable: false }
  for (let s = rangeStart; s < rangeEnd; s++) {
    const t = p.sourceT[s]!
    if (t === -1) continue
    if (!isJustifiableCharacter(p, s, f.end, leaf.is8bit, style.whiteSpaceIsSignificant, cj)) continue
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
  return { info, assignments }
}

function emptyFrame(p: GeckoPrepared, frame: number, contentStart: number, offset: number, contentLength: number): FrameResult {
  return {
    frame, contentStart, offset, contentLength, tEnd: Math.min(p.nextT[contentStart + contentLength]!, p.frames[frame]!.tEnd),
    width: 0, nonEmpty: false, usedHyphenation: false, trimmedTrailingWhitespace: false, trimmableChars: 0, hangableISize: 0,
    status: 'complete', incomplete: false, endsInNewline: false, prov: null, justification: NO_JUSTIFICATION, trimmableWS: null,
  }
}

function sourceOffsetAt(p: GeckoPrepared, t: number): number {
  return t < p.tSource.length ? p.tSource[t]! : p.text.length
}

// nsTextFrame::ReflowText (nsTextFrame.cpp:10847-11532) into the current span.
function reflowText(p: GeckoPrepared, ll: LineLayout, psd: SpanData, item: number, fi: number, contentStart: number): FrameResult {
  const f = p.frames[fi]!
  const run = p.textRuns[f.textRun]!
  const leaf = p.leaves[f.run]!
  const style = leaf.style
  const maxContentLength = f.end - contentStart
  if (maxContentLength === 0) return emptyFrame(p, fi, contentStart, contentStart, maxContentLength)
  const atStartOfLine = ll.lineAtStart
  let offset = contentStart
  let length = maxContentLength
  let newLineOffset = -1
  if (style.newlineIsSignificant) {
    let lo = 0, hi = p.lineFeeds.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (p.lineFeeds[mid]! < offset) lo = mid + 1
      else hi = mid
    }
    const nl = p.lineFeeds[lo] ?? -1
    if (nl >= 0 && nl < offset + length) {
      newLineOffset = nl
      length = nl + 1 - offset
    }
  }
  if (atStartOfLine && !style.whiteSpaceIsSignificant) {
    const skipLength = newLineOffset >= 0 ? length - 1 : length
    let count = 0
    while (count < skipLength && isTrimmableChar(p.text, offset + count, f.end, leaf.is8bit)) count++
    offset += count
    length -= count
  }
  if (length === 0) return emptyFrame(p, fi, contentStart, offset, maxContentLength)
  const tOffset = Math.min(p.nextT[offset]!, f.tEnd)
  let forceBreak = ll.force !== null && ll.force.item === item && ll.force.contentStart === contentStart ? ll.force.offset : -1
  let forceBreakAfter = false
  if (forceBreak >= length) {
    forceBreakAfter = forceBreak === length
    forceBreak = -1
  }
  const limitLength = forceBreak >= 0 ? forceBreak : length
  const tLength = Math.min(p.nextT[offset + limitLength]!, f.tEnd) - tOffset
  // availableSpaceOnLine (nsLineLayout.cpp:798), whose mInset is text-wrap: balance's, which the model doesn't have.
  const availWidth = psd.iEnd - psd.iCoord
  const canTrim = !style.whiteSpaceIsSignificant
  // GetCurrentFrameInlineDistanceFromBlock less the block's padding, 0 here (nsTextFrame.cpp:11063-11067,
  // nsLineLayout.cpp:1154-1160): the sum of the span chain's inline coordinates.
  const tabWidths = computeTabs(p, ll, run, fi, tOffset, tOffset + tLength, psd)
  const prov: Provider = {
    run, frame: fi, start: offset, length, startT: tOffset, startOfLine: atStartOfLine, letterSpacingAu: leaf.letterSpacingAu,
    tabs: tabWidths?.tabs ?? NO_TABS,
  }
  // LineIsBreakable: a placed frame or a band impacted by floats (nsLineLayout.h:151-155; nsTextFrame.cpp:11133-11135).
  const lineIsBreakable = ll.totalPlaced > 0 || ll.impactedByFloats
  const r = breakAndMeasureText(p, prov, tOffset, tLength, availWidth, lineIsBreakable ? 'none' : 'initial',
    style.wordCanWrap, style.wrap, style.isBreakSpaces, canTrim || style.whitespaceCanHang, ll.lastOptPriority, ll.gaps, ll.consulted, tabWidths?.through ?? null)
  gaps.emergencyHyphenBreak(ll.gaps, p, f.run, style.wordCanWrap, r, tOffset, tLength)
  let charsFit = sourceOffsetAt(p, tOffset + r.charsFit) - offset
  if (offset + charsFit === newLineOffset) charsFit++
  let lastBreak: number | null = null
  let usedHyphenation = r.usedHyphenation
  if (charsFit >= limitLength) {
    charsFit = limitLength
    if (r.lastBreak !== null) lastBreak = sourceOffsetAt(p, tOffset + r.lastBreak)
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
      if (ll.recordFrames && p.paragraph.textAlign === 'justify') trimmableWS = { advance: trimmable, count: r.trimmableChars }
      adv -= hang
      trimmable = 0
    }
  }
  if (!brokeText && lastBreak !== null) notifyOptionalBreak(ll, { item, contentStart, offset: lastBreak - offset }, true, r.breakPriority)
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
  else if (contentLength > 0 && contentStart + contentLength - 1 === newLineOffset) {
    // rule gecko/lines/preserved-newline-ends-line-in-br
    // A frame that ends in a preserved newline marks the line as ending in a BR (nsTextFrame.cpp:11472-11476), as a <br>
    // does: the line takes the last line's alignment, so justify doesn't expand it, and it isn't marked wrapped
    // (nsBlockFrame.cpp:5971-5974, :5604-5606; rich-prewrap/newlines c-b4c6bea8cb3653f5).
    status = 'break-after'
    endsInNewline = true
    ll.lineEndsInBR = true
  }
  else if (breakAfter) status = 'break-after'
  // Justification metadata is only read when placing a retained frame; it never enters break decisions.
  // Opportunities over [offset, offset + charsFit) when the block justifies (nsTextFrame.cpp:11513-11521).
  const justification = ll.recordFrames && p.paragraph.textAlign === 'justify' ? computeJustification(p, fi, offset, offset + charsFit).info : NO_JUSTIFICATION
  return {
    frame: fi, contentStart, offset, contentLength, tEnd: Math.min(p.nextT[contentStart + contentLength]!, f.tEnd), width, nonEmpty,
    usedHyphenation, trimmedTrailingWhitespace, trimmableChars: r.trimmableChars, hangableISize, status,
    incomplete: contentLength !== maxContentLength, endsInNewline, prov, justification, trimmableWS,
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
export type Position = { item: number; offset: number }

// nsReflowStatus as far as the line reads it: break-before (the frame is pushed), break-after, incomplete; with the position
// the rest of the content starts at.
type Status = { breakBefore: boolean; breakAfter: boolean; incomplete: boolean; next: Position }

export const itemAt = (p: GeckoPrepared, k: number): number => k < p.items.length ? p.items[k]!.at : p.text.length
const completeAt = (p: GeckoPrepared, k: number): Status => ({ breakBefore: false, breakAfter: false, incomplete: false, next: { item: k, offset: itemAt(p, k) } })

type Pass = { kind: 'below-floats' } | { kind: 'line'; status: Status; ll: LineLayout; redo: boolean }

// The band a slot gives the line (nsBlockFrame::DoReflowInlineFrames, nsBlockFrame.cpp:5252-5273): the float available
// space's logical start and inline size, and whether floats narrow it. The slot insets are the float margin boxes' CSS px
// widths, ToAppUnits like any length.
export type Band = { iStart: number; iSize: number; impactedByFloats: boolean; left: number; containerWidth: number }

function bandOf(p: GeckoPrepared, slot: LineSlot): Band {
  const containerWidth = pxToAu(slot.width)
  const left = pxToAu(slot.left)
  const right = pxToAu(slot.right)
  const rtl = p.paragraph.direction === 'rtl'
  return { iStart: rtl ? right : left, iSize: containerWidth - left - right, impactedByFloats: slot.left !== 0 || slot.right !== 0, left, containerWidth }
}

// nsBlockFrame::DoReflowInlineFrames (nsBlockFrame.cpp:5232-5476) with nsLineLayout::BeginLineReflow (nsLineLayout.cpp:107-221).
function reflowPass(p: GeckoPrepared, start: GeckoLineStart, band: Band, force: BreakPosition | null, inspect: GeckoLineInspect | null, recordFrames: boolean): Pass {
  const root: SpanData = {
    element: -1, iStart: band.iStart, iCoord: band.iStart + (start.isFirstLine ? p.textIndentAu : 0), iEnd: band.iStart + band.iSize,
    noWrap: !p.blockStyle.wrap, frames: [], hasNonemptyContent: false, parent: null,
  }
  const ll: LineLayout = {
    gaps: inspect === null ? null : inspect.gaps, consulted: inspect === null ? null : inspect.consulted, root, recordFrames, tabPrefix: inspect === null ? null : { through: 0, reason: null }, lineIsEmpty: true, lineAtStart: true, totalPlaced: 0, trimmableISize: 0, needBackup: false, lastOpt: null,
    lastOptPriority: NO_BREAK, force, impactedByFloats: band.impactedByFloats, lineEndsInBR: false, lineWrapped: false,
  }
  // With floats in the band the line start is a soft break: the line can always move below them (nsBlockFrame.cpp:5289-5299).
  if (band.impactedByFloats && notifyOptionalBreak(ll, { item: start.frame, contentStart: start.contentOffset, offset: 0 }, true, NORMAL_BREAK)) {
    return { kind: 'below-floats' }
  }
  const status = reflowChildren(p, ll, root, start.frame, p.items.length, openSpansAt(p, start), 0, start)
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
    case 'text': parent = p.leaves[p.frames[item.frame]!.run]!.parent; break
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
type ReflowSpan = {
  span: SpanData; open: GeckoEdgeItem | null; end: number; finalClose: boolean; notSafeToBreak: boolean
  iStart: number; startMargin: number; startEdge: number; hasPrev: boolean; childFrom: number; placedAtStart: number
}
type ChildWalk = { psd: SpanData; k: number; end: number; first: boolean; depth: number; span: ReflowSpan | null }

function reflowChildren(p: GeckoPrepared, ll: LineLayout, psd: SpanData, from: number, end: number, chain: number[],
  depth: number, start: GeckoLineStart): Status | 'redo-next-band' {
  const stack: ChildWalk[] = [{ psd, k: from, end, first: true, depth, span: null }]
  let returned: Status | null = null
  const finish = (s: Status): Status => {
    const done = stack.pop()!
    return done.span === null ? s : endReflowSpan(p, ll, done.span, s)
  }
  while (stack.length > 0) {
    const walk = stack[stack.length - 1]!
    if (returned === null && walk.k >= walk.end) {
      returned = finish(completeAt(p, walk.end))
      continue
    }
    if (returned === null) {
      let element = -1, open: GeckoEdgeItem | null = null, childFrom = walk.k, childDepth = chain.length
      if (walk.first && walk.depth < chain.length) {
        element = chain[walk.depth]!
        childDepth = walk.depth + 1
      } else {
        const item = p.items[walk.k]!
        switch (item.kind) {
          case 'text': {
            const f = p.frames[item.frame]!
            returned = reflowTextFrame(p, ll, walk.psd, walk.k, item.frame, walk.k === start.frame ? Math.max(start.contentOffset, f.start) : f.start)
            break
          }
          case 'open': element = item.element; open = item; childFrom = walk.k + 1; break
          case 'atomic': case 'br': case 'wbr': returned = reflowLeaf(p, ll, walk.psd, walk.k, item); break
          case 'close': throw new Error(`gecko: close event ${walk.k} outside its span`)
        }
      }
      if (element >= 0) {
        const span = beginReflowSpan(p, ll, walk.psd, element, open, childFrom)
        stack.push({ psd: span.span, k: childFrom, end: span.end, first: true, depth: childDepth, span })
        continue
      }
    }
    const s = returned!
    if (walk.psd.element >= 0) {
      if (s.breakBefore) {
        returned = finish(walk.first ? s : { breakBefore: false, breakAfter: true, incomplete: true, next: s.next })
        continue
      }
      if (s.breakAfter) {
        returned = finish(s.next.item < walk.end ? { ...s, incomplete: true } : s)
        continue
      }
      if (s.incomplete) { returned = finish(s); continue }
    } else {
      if (s.breakBefore) {
        if (walk.first) {
          if (!ll.impactedByFloats) throw new Error(`gecko: the first frame of a line without floats broke before at item ${walk.k}`)
          return 'redo-next-band'
        }
        ll.lineWrapped = true
        returned = finish(s)
        continue
      }
      if (s.incomplete && !ll.lineEndsInBR) ll.lineWrapped = true
      if (s.breakAfter || s.incomplete) { returned = finish(s); continue }
    }
    walk.k = s.next.item
    walk.first = false
    returned = null
  }
  return returned!
}

// nsLineLayout::ReflowFrame for a text frame (nsLineLayout.cpp:733-1092) and its CanPlaceFrame branch (:1189-1342).
function reflowTextFrame(p: GeckoPrepared, ll: LineLayout, psd: SpanData, k: number, frame: number, contentStart: number): Status {
  const notSafeToBreak = ll.lineIsEmpty && !ll.impactedByFloats // :785
  const iStart = psd.iCoord
  const r = reflowText(p, ll, psd, k, frame, contentStart)
  if (r.status === 'break-before') return { breakBefore: true, breakAfter: false, incomplete: false, next: { item: k, offset: contentStart } }
  // A text frame can continue a text run, so it is always placed, and an overflow requests backup (:1323-1335).
  if (!psd.noWrap && iStart + r.width - ll.trimmableISize > psd.iEnd && r.width !== 0 && !notSafeToBreak) ll.needBackup = true
  if (r.nonEmpty) {
    psd.hasNonemptyContent = true
    ll.lineIsEmpty = false
    ll.lineAtStart = false
  }
  if (ll.recordFrames) psd.frames.push({ kind: 'text', item: k, r, iStart, iSize: r.width })
  psd.iCoord = iStart + r.width
  ll.totalPlaced++
  const next = r.incomplete ? { item: k, offset: r.contentStart + r.contentLength } : { item: k + 1, offset: itemAt(p, k + 1) }
  return { breakBefore: false, breakAfter: r.status === 'break-after', incomplete: r.incomplete, next }
}

// An inline element: nsLineLayout::ReflowFrame (nsLineLayout.cpp:733-1092) into nsInlineFrame::ReflowFrames
// (nsInlineFrame.cpp:489-688) with BeginSpan and EndSpan (nsLineLayout.cpp:378-436), then CanPlaceFrame and PlaceFrame for the
// span frame. `open`: the frame's open item, the one before `childFrom`; null where the span's frame on this line continues
// one from an earlier line.
function beginReflowSpan(p: GeckoPrepared, ll: LineLayout, parent: SpanData, element: number, open: GeckoEdgeItem | null,
  childFrom: number): ReflowSpan {
  const el = spanAt(p.elements, element)
  const notSafeToBreak = ll.lineIsEmpty && !ll.impactedByFloats
  const iStart = parent.iCoord
  const availableSpaceOnLine = parent.iEnd - parent.iCoord
  // GetPrevContinuation is set: the frame continues one from an earlier line, or its open item begins a bidi continuation.
  const hasPrev = open === null || open.split
  // Its children end at this continuation's close item; only the element's own close ends the last continuation.
  let end = el.close
  let lo = 0, hi = el.closes.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (el.closes[mid]! < childFrom) lo = mid + 1
    else hi = mid
  }
  if (lo < el.closes.length) end = el.closes[lo]!
  const finalClose = end === el.close
  // AllowForStartMargin: only the first continuation keeps its start margin (nsLineLayout.cpp:1110-1134).
  const startMargin = hasPrev ? 0 : el.edges.startMargin
  // The start border and padding only without a previous continuation; the end border and padding off every line
  // (nsInlineFrame.cpp:500-521).
  const startEdge = hasPrev ? 0 : el.edges.startBorderPadding
  const availableISize = availableSpaceOnLine - startMargin - startEdge - el.edges.endBorderPadding
  const span: SpanData = {
    element, iStart: startEdge, iCoord: startEdge, iEnd: startEdge + availableISize, noWrap: !el.style.wrap, frames: [],
    hasNonemptyContent: false, parent,
  }
  return { span, open, end, finalClose, notSafeToBreak, iStart, startMargin, startEdge, hasPrev, childFrom, placedAtStart: ll.totalPlaced }
}

function endReflowSpan(p: GeckoPrepared, ll: LineLayout, state: ReflowSpan, s: Status): Status {
  const { span, open, end, finalClose, notSafeToBreak, iStart, startMargin, startEdge, hasPrev, childFrom, placedAtStart } = state
  const parent = span.parent!
  const el = spanAt(p.elements, span.element)
  if (s.breakBefore) {
    // The span frame itself is pushed (nsLineLayout.cpp:1081-1084, nsInlineFrame.cpp:717-731).
    return { ...s, next: open === null ? s.next : { item: childFrom - 1, offset: open.at } }
  }
  const complete = !s.incomplete
  // The end edge and margin only when complete without a bidi continuation after (nsInlineFrame.cpp:670-674,
  // nsLineLayout.cpp:1217-1224).
  const last = complete && finalClose
  // Every placed child increments totalPlaced, including an empty nested span. A pass never removes a placed frame,
  // so this local entry count says whether the span placed children without depending on retained output records.
  // EndSpan's width, 0 without placed frames (nsLineLayout.cpp:431), plus the edges ReflowFrames adds (nsInlineFrame.cpp:643-674).
  const iSize = (ll.totalPlaced > placedAtStart ? span.iCoord - span.iStart : 0) + startEdge + (last ? el.edges.endBorderPadding : 0)
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
  if (ll.recordFrames) parent.frames.push({ kind: 'span', element: span.element, span, iStart: placedStart, iSize, hasStartEdge: !hasPrev, hasEndEdge: last })
  parent.iCoord = placedStart + iSize + endMargin
  ll.totalPlaced++
  return complete ? { ...s, next: { item: end + 1, offset: itemAt(p, end + 1) } } : s
}

// nsLineLayout::ReflowFrame for an atomic inline, <br> or <wbr> (nsLineLayout.cpp:733-1092): BRFrame::Reflow ends the line
// after itself (BRFrame.cpp:98-166); a WBRFrame reflows to 0 × 0 and isn't empty (nsIFrame::IsEmpty, nsIFrame.cpp:9380-9382).
// None continues a text run, so each clears the trimmable width (except the BR, skipped when trimming, :1015-1020), may be
// pushed when it overflows (CanPlaceFrame :1189-1342), and records a break after itself (:1057-1071).
function reflowLeaf(p: GeckoPrepared, ll: LineLayout, psd: SpanData, k: number, item: GeckoObjectItem): Status {
  const el = objectAt(p.elements, item.element)
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
  if (ll.recordFrames) psd.frames.push({ kind: item.kind, element: item.element, iStart: iStart + startMargin, iSize, startMargin, endMargin })
  psd.iCoord = iStart + startMargin + iSize + endMargin
  ll.totalPlaced++
  if (!psd.noWrap && !ll.lineIsEmpty) {
    if (notifyOptionalBreak(ll, { item: k, contentStart: item.at, offset: AFTER_CONTENT }, optionalBreakAfterFits, NORMAL_BREAK)) breakAfter = true
  }
  return { breakBefore: false, breakAfter, incomplete: false, next: { item: k + 1, offset: itemAt(p, k + 1) } }
}

// nsBlockFrame::ReflowInlineFrames (nsBlockFrame.cpp:5123-5199): one redo with the saved break forced. Both passes write
// the fill's one record, so the line's report reads what the dropped pass consulted too.
function reflowLine(p: GeckoPrepared, start: GeckoLineStart, band: Band, inspect: GeckoLineInspect | null, recordFrames: boolean): Pass {
  const pass = reflowPass(p, start, band, null, inspect, recordFrames)
  if (pass.kind === 'below-floats' || !pass.redo) return pass
  return reflowPass(p, start, band, pass.ll.lastOpt, inspect, recordFrames)
}

// A block with frames has at least one line; a paragraph whose text nodes all lack frames and has no elements has none.
export function firstGeckoLine(p: GeckoPrepared): GeckoLineStart | null {
  return p.items.length === 0 ? null : { engine: 'gecko', frame: 0, contentOffset: 0, isFirstLine: true }
}

// What a fill leaves for the line's gaps (gaps.ts lineGaps), across its passes and in order, the dropped pass of a redo
// included: the gaps the passes raised, and the in-word stand-in offsets their break scans consulted (glyphBefore), as
// transformed offsets.
export type GeckoLineInspect = { gaps: Gap[]; consulted: number[] }

// The decided line: what a fill leaves of the line it decided, which linePieces and inspectLine read and nothing writes.
export type GeckoFilledLine = {
  engine: 'gecko'
  kind: 'line'
  start: GeckoLineStart
  band: Band
  // The last pass's placed frames, as reflow left them, and what it says of the line's end.
  root: SpanData
  lineEndsInBR: boolean
  lineWrapped: boolean
  // Where the content after the line starts; past the last item after the last line.
  next: Position
  // Null on a plain paragraph.
  inspect: GeckoLineInspect | null
}
export type GeckoRefusedSlot = { engine: 'gecko'; kind: 'below-floats'; gaps: Gap[] | null }
export type GeckoFillResult = FillResultOf<GeckoLineStart, GeckoFilledLine, GeckoRefusedSlot>

// A range keeps only what consuming the next slot needs. It cannot be passed to the full line's piece/inspection helpers.
export type GeckoRangeFillResult = RangeFillResultOf<GeckoLineStart>

export function fillLine(p: GeckoPrepared, start: GeckoLineStart, slot: LineSlot): GeckoFillResult {
  return fillLineDecision(p, start, slot, 'full')
}

export function fillLineRange(p: GeckoPrepared, start: GeckoLineStart, slot: LineSlot): GeckoRangeFillResult {
  return fillLineDecision(p, start, slot, 'range')
}

// The same passes and final status decide full and range output. Inspection still retains frames because a tab's gap
// explanation reads the already placed prefix; selecting range output never changes the measurements or diagnostics.
function fillLineDecision(p: GeckoPrepared, start: GeckoLineStart, slot: LineSlot, output: 'full'): GeckoFillResult
function fillLineDecision(p: GeckoPrepared, start: GeckoLineStart, slot: LineSlot, output: 'range'): GeckoRangeFillResult
function fillLineDecision(p: GeckoPrepared, start: GeckoLineStart, slot: LineSlot, output: 'full' | 'range'): GeckoFillResult | GeckoRangeFillResult {
  const band = bandOf(p, slot)
  const inspect: GeckoLineInspect | null = p.inspect === null ? null : { gaps: [], consulted: [] }
  const pass = reflowLine(p, start, band, inspect, output === 'full' || inspect !== null)
  // The next band lays the same line out again.
  if (pass.kind === 'below-floats') {
    if (output === 'range') return { kind: 'below-floats', next: start }
    return { kind: 'below-floats', line: { engine: 'gecko', kind: 'below-floats', gaps: inspect === null ? null : inspect.gaps }, next: start }
  }
  const next = pass.status.next
  if (next.item < start.frame || (next.item === start.frame && next.offset <= start.contentOffset)) {
    throw new Error(`gecko: no progress at item ${start.frame}, offset ${start.contentOffset}`)
  }
  // Characters after the last item belong to text nodes without frames, which the last line holds as collapsed.
  const more = next.item < p.items.length
  const ll = pass.ll
  const end = more ? next.offset : p.text.length
  const nextStart: GeckoLineStart | null = more ? { engine: 'gecko', frame: next.item, contentOffset: next.offset, isFirstLine: start.isFirstLine && ll.lineIsEmpty } : null
  if (output === 'range') return { kind: 'line', start: start.contentOffset, end, next: nextStart, hasLineBox: !ll.lineIsEmpty }
  return {
    kind: 'line',
    line: { engine: 'gecko', kind: 'line', start, band, root: ll.root, lineEndsInBR: ll.lineEndsInBR, lineWrapped: ll.lineWrapped, next, inspect },
    start: start.contentOffset, end,
    next: nextStart,
    hasLineBox: !ll.lineIsEmpty,
  }
}
