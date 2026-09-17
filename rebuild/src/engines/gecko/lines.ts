// Line filling for Gecko (Firefox 156.0): nsBlockFrame::ReflowInlineFrames with at most one redo, nsLineLayout's
// ReflowFrame / CanPlaceFrame / NotifyOptionalBreakPosition, nsTextFrame::ReflowText, gfxTextRun::BreakAndMeasureText,
// TrimTrailingWhiteSpaceIn, TextAlignLine and nsBidiPresUtils::ReorderFrames. specs/gecko-lines.md §4-§6; widths are
// integer app units throughout (§2.8). A line returns the frames Gecko placed on it (DESIGN.md §2.5), and fragments
// classified by the frames' own flags.
import type { Measurer } from '../../measure/canvas.js'
import type { Fragment, Gap, GeckoCharacter, GeckoFrameGeometry, GeckoLine } from '../../model.js'
import { BREAK_EMERGENCY_WRAP, BREAK_NORMAL } from './linebreak.js'
import { frameOfSource, isTrimmableChar, pxToAu, rangeAu } from './prepare.js'
import { joiningType } from './props.js'
import { KIND_NEWLINE, KIND_TAB, type GeckoLineStart, type GeckoPrepared, type GeckoTextRun } from './types.js'

const SHY = 0x00ad
const NO_BREAK = 0 // gfxBreakPriority (gfxTypes.h:48)
const WORD_WRAP_BREAK = 1
const NORMAL_BREAK = 2

// The gaps one line's filling runs into (DESIGN.md §2.8): in-word-prefix at the first in-word offset the line consults
// whose recipe Canvas can't confirm.
type LineGaps = { list: Gap[]; inWordReported: boolean }

function reportInWordGap(p: GeckoPrepared, gaps: LineGaps, t: number, detail: string): void {
  gaps.inWordReported = true
  gaps.list.push({ gap: 'in-word-prefix', run: p.frames[frameOfSource(p.frames, p.tSource[t]!)]!.run, detail })
}

// The glyph advance of text run characters before t, the sum of the DOM's glyph records (gfxTextRun::GetAdvanceWidth,
// gfxTextRun.cpp:1214-1256): unit totals, and inside a unit W(unit) − W(suffix) (DESIGN.md §5 in-word-prefix,
// specs/gecko-lines.md §9 "Not obtainable" 1). The records come from one shaping of the unit, which no Canvas string
// exposes, so where kerning, ligatures or joining cross t the recipe is a stand-in. `gaps` is the line whose breaks
// consult t, or null where the advance only places geometry.
function glyphBefore(p: GeckoPrepared, m: Measurer, run: GeckoTextRun, t: number, gaps: LineGaps | null): number {
  if (t >= run.tEnd) return run.totalAdvance
  const unit = p.units[p.unitOf[t]!]!
  if (t === unit.tStart) return unit.startAdvance
  if (p.clusterStart[t] === 0) {
    // Inside a grapheme cluster (only a soft hyphen breaks there, GetHyphenationBreaks). HarfBuzz attaches a clump's
    // glyphs to its first character and marks the rest ligature continuations (gfxHarfBuzzShaper.cpp:1705-1786), and a
    // range edge inside a ligature gets the ligature's width per started cluster (ComputeLigatureData,
    // gfxTextRun.cpp:238-322): the part holding the cluster start takes the whole cluster. So the advance before t is
    // the advance before the cluster's end. Canvas can't show ligature groups: where [t, cluster end) has an advance of
    // its own, the DOM can give it to either side.
    let end = t + 1
    while (end < unit.tEnd && p.clusterStart[end] === 0) end++
    if (gaps !== null && !gaps.inWordReported) {
      const fromT = rangeAu(m, run, p.tUnits, t, unit.tEnd)
      const fromEnd = end === unit.tEnd ? 0 : rangeAu(m, run, p.tUnits, end, unit.tEnd)
      if (fromT !== fromEnd) {
        reportInWordGap(p, gaps, t, `offset ${p.tSource[t]} inside a grapheme cluster: W(suffix) is ${fromT} au from the offset, ${fromEnd} au from the cluster's end; the DOM gives a ligature's width to its clusters (gfxTextRun.cpp:238-322)`)
      }
    }
    return glyphBefore(p, m, run, end, gaps)
  }
  const suffixAu = rangeAu(m, run, p.tUnits, t, unit.tEnd)
  if (gaps !== null && !gaps.inWordReported) {
    // The recipe is exact when nothing in the unit's shaping crosses t: the prefix and suffix shaped alone then add up to
    // the unit. Kerning, ligatures and contextual forms across t break the sum. Letters that join across t take joined
    // forms in the DOM and isolated or initial forms in W(suffix) (Joining_Type, ArabicShaping.txt).
    const joins = joinsAcross(p, unit, t)
    const prefixAu = rangeAu(m, run, p.tUnits, unit.tStart, t)
    if (joins || prefixAu + suffixAu !== unit.canvasAu) {
      reportInWordGap(p, gaps, t, `offset ${p.tSource[t]}: ${joins ? 'letters join across it' : `W(prefix) + W(suffix) = ${prefixAu + suffixAu} au, W(unit) = ${unit.canvasAu} au`}`)
    }
  }
  return unit.startAdvance + unit.canvasAu - suffixAu + (p.correctionPrefix[t]! - p.correctionPrefix[unit.tStart]!)
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

// BreakAndMeasureText's running width: GetAdvanceForGlyph per character, a ligature's whole width on its first character,
// with spacing and tabs (gfxTextRun.cpp:989, :1139-1159). Canvas can't see ligatures, so the recipe equals advanceWidth's.
function scanAdvance(p: GeckoPrepared, m: Measurer, prov: Provider, a: number, b: number, gaps: LineGaps): number {
  return rangeAdvance(p, m, prov, a, b, gaps)
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
// characters ending in SHY, inside this frame's measured content, not at the frame start of a line-starting frame.
function hyphenSoft(p: GeckoPrepared, prov: Provider, t: number): boolean {
  if (!p.style.wrap) return false
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
        const pendingAdvance = scanAdvance(p, m, prov, pending, i, gaps)
        const trimmableAdvance = trimmableChars > 0 ? scanAdvance(p, m, prov, trimStart, i, gaps) : 0
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
  if (!aborted) width += scanAdvance(p, m, prov, pending, end, gaps)
  let trimmableAdvance = trimmableChars > 0 ? scanAdvance(p, m, prov, trimStart, scanEnd, gaps) : 0
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

type LineLayout = {
  avail: number
  x: number
  totalPlaced: number
  lineIsEmpty: boolean
  lineAtStart: boolean
  trimmableISize: number
  needBackup: boolean
  lastOpt: { frame: number; contentStart: number; offset: number } | null
  lastOptPriority: number
  force: { frame: number; contentStart: number; offset: number } | null
}

// nsLineLayout::NotifyOptionalBreakPosition (nsLineLayout.cpp:1495-1516).
function notifyOptionalBreak(ll: LineLayout, frame: number, contentStart: number, offset: number, fits: boolean, priority: number): void {
  if ((fits && priority >= ll.lastOptPriority) || ll.lastOpt === null) {
    ll.lastOpt = { frame, contentStart, offset }
    ll.lastOptPriority = priority
  }
}

type FrameResult = {
  frame: number
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
}

// nsTextFrame::ReflowText (nsTextFrame.cpp:10847-11532).
function reflowText(p: GeckoPrepared, m: Measurer, ll: LineLayout, fi: number, contentStart: number, gaps: LineGaps): FrameResult {
  const f = p.frames[fi]!
  const run = p.textRuns[f.textRun]!
  const style = p.style
  const maxContentLength = f.end - contentStart
  const empty = (offset: number): FrameResult => ({
    frame: fi, contentStart, offset, length: 0, charsFit: 0, contentLength: maxContentLength,
    tEnd: Math.min(p.nextT[contentStart + maxContentLength]!, f.tEnd), advance: 0, width: 0, nonEmpty: false,
    usedHyphenation: false, brokeText: false, trimmedTrailingWhitespace: false, trimmableChars: 0, hangableISize: 0,
    status: 'complete', incomplete: false, endsInNewline: false, prov: null,
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
  let forceBreak = ll.force !== null && ll.force.frame === fi && ll.force.contentStart === contentStart ? ll.force.offset : -1
  let forceBreakAfter = false
  if (forceBreak >= length) {
    forceBreakAfter = forceBreak === length
    forceBreak = -1
  }
  const limitLength = forceBreak >= 0 ? forceBreak : length
  const tLength = Math.min(p.nextT[offset + limitLength]!, f.tEnd) - tOffset
  const availWidth = ll.avail - ll.x
  const canTrim = !style.whiteSpaceIsSignificant
  const prov: Provider = {
    run, frame: fi, start: offset, length, startT: tOffset, startOfLine: atStartOfLine, letterSpacingAu: p.letterSpacingAu[f.run]!,
    tabs: new Map(),
  }
  computeTabs(p, m, prov, tOffset + tLength, ll.x, gaps)
  const r = breakAndMeasureText(p, m, prov, tOffset, tLength, availWidth, ll.totalPlaced > 0 ? 'none' : 'initial',
    style.wordCanWrap, style.wrap, style.isBreakSpaces, canTrim || style.whitespaceCanHang, ll.lastOptPriority, gaps)
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
      adv -= hang
      trimmable = 0
    }
  }
  if (!brokeText && lastBreak >= 0) notifyOptionalBreak(ll, fi, contentStart, lastBreak - offset, true, r.breakPriority)
  const contentLength = offset + charsFit - contentStart
  const width = Math.ceil(Math.max(0, adv))
  let nonEmpty = usedHyphenation
  if (r.charsFit > 0) {
    ll.trimmableISize = Math.floor(trimmable)
    nonEmpty = true
  }
  let breakAfter = forceBreakAfter
  if (charsFit > 0 && charsFit === length && hasSoftHyphenBefore(p, offset, offset + charsFit)) {
    notifyOptionalBreak(ll, fi, contentStart, length, adv + run.hyphenAu + prov.letterSpacingAu <= availWidth, NORMAL_BREAK)
  }
  if (!breakAfter && charsFit === length && tOffset + tLength === run.tEnd && run.trailingBreak) {
    if (adv - trimmable > availWidth) breakAfter = true
    else notifyOptionalBreak(ll, fi, contentStart, length, true, NORMAL_BREAK)
  }
  let status: FrameResult['status'] = 'complete'
  let endsInNewline = false
  if (charsFit === 0 && length > 0 && !usedHyphenation) status = 'break-before'
  else if (contentLength > 0 && contentStart + contentLength - 1 === newLineOffset) { status = 'break-after'; endsInNewline = true }
  else if (breakAfter) status = 'break-after'
  return {
    frame: fi, contentStart, offset, length, charsFit, contentLength, tEnd: Math.min(p.nextT[contentStart + contentLength]!, f.tEnd),
    advance: adv, width, nonEmpty, usedHyphenation, brokeText, trimmedTrailingWhitespace, trimmableChars: r.trimmableChars,
    hangableISize, status, incomplete: contentLength !== maxContentLength, endsInNewline, prov,
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

// `pushed`: the pass ended by pushing a frame to the next line (break-before).
type Pass = { redo: boolean; placed: FrameResult[]; nextPos: number; pushed: boolean; ll: LineLayout }

// nsBlockFrame::DoReflowInlineFrames (nsBlockFrame.cpp:5232-5476) over the frames from `pos`.
function reflowPass(p: GeckoPrepared, m: Measurer, pos: number, avail: number, force: LineLayout['force'], gaps: LineGaps): Pass {
  const ll: LineLayout = {
    avail, x: 0, totalPlaced: 0, lineIsEmpty: true, lineAtStart: true, trimmableISize: 0, needBackup: false,
    lastOpt: null, lastOptPriority: NO_BREAK, force,
  }
  const placed: FrameResult[] = []
  let nextPos = p.text.length
  let pushed = false
  let fi = 0
  while (fi < p.frames.length && p.frames[fi]!.end <= pos) fi++
  for (let first = true; fi < p.frames.length; fi++, first = false) {
    const f = p.frames[fi]!
    const contentStart = first ? Math.max(pos, f.start) : f.start
    const notSafeToBreak = ll.lineIsEmpty
    const r = reflowText(p, m, ll, fi, contentStart, gaps)
    if (r.status === 'break-before') { // nsLineLayout.cpp:1081-1084, nsBlockFrame.cpp:5547-5566
      nextPos = contentStart
      pushed = true
      break
    }
    // CanPlaceFrame (nsLineLayout.cpp:1189-1342) for a text frame: it is always placed; overflow requests backup.
    if (p.style.wrap && ll.x + r.width - ll.trimmableISize > ll.avail && r.width !== 0 && !notSafeToBreak) ll.needBackup = true
    ll.x += r.width
    ll.totalPlaced++
    if (r.nonEmpty) {
      ll.lineIsEmpty = false
      ll.lineAtStart = false
    }
    placed.push(r)
    if (r.status === 'break-after' || r.incomplete) {
      nextPos = contentStart + r.contentLength
      break
    }
  }
  const redo = ll.needBackup && ll.force === null && ll.lastOpt !== null // nsBlockFrame.cpp:5361-5379
  return { redo, placed, nextPos, pushed, ll }
}

// nsBlockFrame::ReflowInlineFrames (nsBlockFrame.cpp:5123-5199): one redo with the saved break forced.
function reflowLine(p: GeckoPrepared, m: Measurer, pos: number, avail: number, gaps: LineGaps): Pass {
  const pass = reflowPass(p, m, pos, avail, null, gaps)
  if (!pass.redo) return pass
  return reflowPass(p, m, pos, avail, pass.ll.lastOpt, gaps)
}

// A block with frames has at least one line; a paragraph whose text nodes all lack frames has none.
export function firstGeckoLine(p: GeckoPrepared): GeckoLineStart | null {
  return p.frames.length === 0 ? null : { engine: 'gecko', contentOffset: 0 }
}

export function nextGeckoLine(p: GeckoPrepared, start: GeckoLineStart, availableWidth: number, m: Measurer): GeckoLine {
  const avail = pxToAu(availableWidth)
  const gaps: LineGaps = { list: [], inWordReported: false }
  const pass = reflowLine(p, m, start.contentOffset, avail, gaps)
  if (pass.nextPos <= start.contentOffset) throw new Error(`gecko: no progress at ${start.contentOffset}`)
  // Characters after the last frame belong to text nodes without frames, which no line holds.
  const more = p.frames[p.frames.length - 1]!.end > pass.nextPos
  const end = more ? pass.nextPos : p.text.length
  return lineOutput(p, m, start.contentOffset, end, pass, avail, gaps, more ? { engine: 'gecko', contentOffset: end } : null)
}

// Per source unit from the frame's measured start: what GetAdvanceWidth adds for it (gfxTextRun.cpp:1214-1256,
// nsTextFrame.cpp:4089-4295): a cluster's glyph advance on its first character, the spacing after a character on that
// character, a tab's width on the tab. Skipped characters add nothing.
function characters(p: GeckoPrepared, m: Measurer, r: FrameResult, prov: Provider): GeckoCharacter[] {
  const out: GeckoCharacter[] = []
  let before = glyphBefore(p, m, prov.run, prov.startT, null)
  for (let s = r.offset; s < r.contentStart + r.contentLength; s++) {
    const t = p.sourceT[s]!
    if (t === -1) {
      out.push({ skipped: true, clusterStart: false, advance: 0 })
      continue
    }
    const after = glyphBefore(p, m, prov.run, t + 1, null)
    out.push({
      skipped: false, clusterStart: p.clusterStart[t] === 1,
      advance: after - before + p.spacingPrefix[t + 1]! - p.spacingPrefix[t]! + (prov.tabs.get(t) ?? 0),
    })
    before = after
  }
  return out
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

// The final pass as Gecko's line: TrimTrailingWhiteSpaceIn, TextAlignLine and ReorderFrames give the frames' boxes and
// positions; the frames' flags classify the fragments.
function lineOutput(p: GeckoPrepared, m: Measurer, lineStart: number, lineEnd: number, pass: Pass, avail: number, gaps: LineGaps,
  next: GeckoLineStart | null): GeckoLine {
  const style = p.style
  const placed = pass.placed

  // TrimTrailingWhiteSpaceIn (nsLineLayout.cpp:2851-2985): from the last frame back to the first with content, a frame not
  // already trimmed at its break loses the floored advance of its trailing IsTrimmableSpace characters, unclamped
  // (nsTextFrame.cpp:11540-11628). trimmedEnd is where that white space starts.
  const trimDelta: number[] = []
  const trimmedEnd: number[] = []
  for (let k = 0; k < placed.length; k++) {
    trimDelta.push(0)
    trimmedEnd.push(placed[k]!.contentStart + placed[k]!.contentLength)
  }
  for (let k = placed.length - 1; k >= 0; k--) {
    const r = placed[k]!
    const f = p.frames[r.frame]!
    const contentEnd = r.contentStart + r.contentLength
    let changed = false
    if (!style.whiteSpaceIsSignificant && !r.trimmedTrailingWhitespace && r.prov !== null) {
      let end = contentEnd
      while (end > r.offset && isTrimmableChar(p.text, end - 1, f.end, f.is8bit)) end--
      trimmedEnd[k] = end
      const tA = Math.min(p.nextT[end]!, f.tEnd)
      const tB = Math.min(p.nextT[contentEnd]!, f.tEnd)
      if (tA < tB) {
        trimDelta[k] = Math.floor(advanceWidth(p, m, r.prov, tA, tB, null))
        changed = true
      }
    }
    if (r.nonEmpty || changed) break
  }

  let lineWidth = 0
  const frames: GeckoFrameGeometry[] = []
  const levels: number[] = []
  for (let k = 0; k < placed.length; k++) {
    const r = placed[k]!
    const f = p.frames[r.frame]!
    const width = r.width - trimDelta[k]!
    lineWidth += width
    levels.push(f.level)
    frames.push({
      run: f.run, contentStart: r.contentStart, contentEnd: r.contentStart + r.contentLength, measuredStart: r.offset,
      level: f.level, x: 0, width, hasHeight: r.nonEmpty, usedHyphen: r.usedHyphenation,
      characters: r.prov === null ? [] : characters(p, m, r, r.prov),
    })
  }

  // TextAlignLine under text-align: start (nsLineLayout.cpp:3482-3670): a wrapped line whose trailing white space hangs
  // against the line's direction moves by the negative hang (GetHangFrom, :3420-3450, reads the last frame; :3598-3605).
  // A line is wrapped when a frame was pushed to the next line or the last frame continues there (nsBlockFrame.cpp:5560-5566,
  // :5598-5607). Positions then come from RepositionInlineFrames, which starts at dx and walks the visual order from the
  // line's start edge, the right edge of an RTL line (nsBidiPresUtils.cpp:1860-1866, :1882-1905). A document without
  // bidi keeps logical order, which equals the visual order of a line whose frames are all at level 0.
  const rtl = p.paragraph.direction === 'rtl'
  const last = placed.length === 0 ? null : placed[placed.length - 1]!
  let hang = 0
  if (last !== null && last.hangableISize !== 0) {
    hang = ((p.frames[last.frame]!.level & 1) === 1) !== rtl ? -last.hangableISize : last.hangableISize
  }
  const wrapped = pass.pushed || (last !== null && last.incomplete)
  const dx = wrapped && hang < 0 ? hang : 0
  const order = visualOrder(levels)
  let startOrEnd = dx
  for (let v = 0; v < order.length; v++) {
    const frame = frames[rtl ? order[order.length - 1 - v]! : order[v]!]!
    frame.x = rtl ? avail - startOrEnd - frame.width : startOrEnd
    startOrEnd += frame.width
  }

  // The white space the line end removed or hangs, by the frames' flags: trailing CharIsSpace characters trimmed at the
  // break (TEXT_TRIMMED_TRAILING_WHITESPACE, nsTextFrame.cpp:11203-11213; CharIsSpace is U+0020 and U+3000,
  // gfxFont.cpp:749-750), the IsTrimmableSpace characters TrimTrailingWhiteSpace removed, and under pre-wrap the trailing
  // CharIsSpace characters of the line's last frames with content (:11214-11229).
  const trimmed = new Set<number>()
  const hanging = new Set<number>()
  for (let k = 0; k < placed.length; k++) {
    const r = placed[k]!
    if (r.trimmedTrailingWhitespace) for (let t = r.tEnd - r.trimmableChars; t < r.tEnd; t++) trimmed.add(p.tSource[t]!)
    for (let s = trimmedEnd[k]!; s < r.contentStart + r.contentLength; s++) if (p.sourceT[s] !== -1) trimmed.add(s)
  }
  if (style.whitespaceCanHang && style.whiteSpaceIsSignificant) {
    for (let k = placed.length - 1; k >= 0; k--) {
      const r = placed[k]!
      if (r.prov === null) continue
      for (let t = r.tEnd - r.trimmableChars; t < r.tEnd; t++) hanging.add(p.tSource[t]!)
      if (r.trimmableChars < r.tEnd - r.prov.startT) break
    }
  }
  const kindOf = (s: number): 'text' | 'trimmed' | 'hanging' => trimmed.has(s) ? 'trimmed' : hanging.has(s) ? 'hanging' : 'text'

  const fragments: Fragment[] = []
  const runOf = (s: number): number => {
    let r = 0
    while (p.runStarts[r + 1]! <= s) r++
    return r
  }
  const frameAt = (s: number): FrameResult | null => {
    for (let k = 0; k < placed.length; k++) {
      const r = placed[k]!
      if (s >= r.contentStart && s < r.contentStart + r.contentLength) return r
    }
    return null
  }
  let lastT = -1
  for (let s = lineStart; s < lineEnd;) {
    const r = frameAt(s)
    if (r === null) {
      let e = s + 1
      while (e < lineEnd && frameAt(e) === null) e++
      pushCollapsed(fragments, runOf, s, e)
      s = e
      continue
    }
    const f = p.frames[r.frame]!
    const contentEnd = r.contentStart + r.contentLength
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
    for (let k = t; k < tEnd; k++) painted += String.fromCharCode(p.tUnits[k]!)
    fragments.push({ kind, run: f.run, start: s, end: e, painted, level: f.level })
    lastT = tEnd
    s = e
  }
  // The hyphen of a used soft hyphen follows the frame's content; its advance is inside the frame's box, without letter
  // spacing (AddHyphenToMetrics, nsTextFrame.cpp:6829-6845).
  for (let k = 0; k < placed.length; k++) {
    const r = placed[k]!
    if (!r.usedHyphenation) continue
    const f = p.frames[r.frame]!
    const at = r.contentStart + r.contentLength
    let index = fragments.length
    while (index > 0 && fragments[index - 1]!.kind !== 'hyphen' && (fragments[index - 1] as { start: number }).start >= at) index--
    fragments.splice(index, 0, { kind: 'hyphen', run: f.run, at, painted: '‐', letterSpacing: 0, level: f.level })
  }
  // The paragraph shaped letters on both sides of this break inside one word: the painter keeps their joining forms.
  let joinsNextLine = false
  if (next !== null && lastT > 0 && lastT < p.tUnits.length && p.unitOf[lastT - 1] === p.unitOf[lastT] &&
    p.units[p.unitOf[lastT]!]!.kind === 'word') {
    joinsNextLine = joinsAcross(p, p.units[p.unitOf[lastT]!]!, lastT)
  }
  let hasLineBox = false
  for (let k = 0; k < placed.length; k++) hasLineBox ||= placed[k]!.nonEmpty
  return {
    start: lineStart, end: lineEnd, fragments, hasLineBox, joinsNextLine,
    geometry: { appUnitsPerDevPixel: p.appUnitsPerDevPixel, availableWidth: avail, width: lineWidth, hang, frames },
    gaps: gaps.list, next,
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
