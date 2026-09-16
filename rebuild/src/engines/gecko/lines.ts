// Line filling for Gecko (Firefox 156.0): nsBlockFrame::ReflowInlineFrames with at most one redo, nsLineLayout's
// ReflowFrame / CanPlaceFrame / NotifyOptionalBreakPosition, nsTextFrame::ReflowText, gfxTextRun::BreakAndMeasureText,
// and TrimTrailingWhiteSpace. specs/gecko-lines.md §4-§6; widths are integer app units throughout (§2.8).
import { measureText, type Measurer } from '../../measure/canvas.js'
import type { Fragment, LineOf } from '../../model.js'
import { BREAK_EMERGENCY_WRAP, BREAK_NORMAL } from './linebreak.js'
import { frameOfSource, isTrimmableChar, pxToAu } from './prepare.js'
import { generalCategory, isDefaultIgnorable, joiningType } from './props.js'
import { KIND_NEWLINE, KIND_TAB, type GeckoLineStart, type GeckoPrepared, type GeckoTextRun } from './types.js'

const SHY = 0x00ad
const NO_BREAK = 0 // gfxBreakPriority (gfxTypes.h:48)
const WORD_WRAP_BREAK = 1
const NORMAL_BREAK = 2

// The glyph advance of text run characters before t (a DOM glyph record sum), from unit totals and, inside a word,
// W(unit) − W(suffix) (DESIGN.md §5 in-word-prefix, specs/gecko-lines.md §9 "Not obtainable" 1).
function glyphBefore(p: GeckoPrepared, m: Measurer, run: GeckoTextRun, t: number): number {
  if (t >= run.tEnd) return run.totalAdvance
  const unit = p.units[p.unitOf[t]!]!
  if (t === unit.tStart) return unit.startAdvance
  const w = (s: string) => Math.round(measureText(m, run.context, s) * 60)
  let suffix = ''
  // The letters on both sides of t join: measured alone, the suffix would take its isolated or initial forms, while the
  // DOM's glyph records keep the joined forms. U+200D is join-causing (Joining_Type C) and has no advance, so Canvas
  // shapes the suffix's first letter joined, as the paragraph did; the prefix keeps what depends on the following letter.
  if (joinsAcross(p, unit, t)) suffix = '‍'
  for (let k = t; k < unit.tEnd; k++) suffix += String.fromCharCode(p.tUnits[k]!)
  const suffixAu = unit.scriptContext === '' ? w(suffix)
    : unit.contextBefore ? w(unit.scriptContext + ' ' + suffix) - w(unit.scriptContext + ' ') : w(suffix + ' ' + unit.scriptContext) - w(' ' + unit.scriptContext)
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

function advance(p: GeckoPrepared, m: Measurer, prov: Provider, a: number, b: number): number {
  if (b <= a) return 0
  let w = glyphBefore(p, m, prov.run, b) - glyphBefore(p, m, prov.run, a) + p.spacingPrefix[b]! - p.spacingPrefix[a]!
  if (prov.run.hasTab) for (const [t, tab] of prov.tabs) if (t >= a && t < b) w += tab
  return w
}

// CalcTabWidths and AdvanceToNextTab (nsTextFrame.cpp:4298-4378): tab stops from the block's content edge.
function computeTabs(p: GeckoPrepared, m: Measurer, prov: Provider, end: number, xForTabs: number): void {
  // GetSpacing calls CalcTabWidths only for a positive tab width (nsTextFrame.cpp:4306-4309): tab-size 0, or letter
  // spacing below minus the space width, leaves tabs at 0.
  if (!prov.run.hasTab || p.tabWidth <= 0) return
  let x = xForTabs
  let from = prov.startT
  for (let t = prov.startT; t < end; t++) {
    if (p.kind[t] !== KIND_TAB) continue
    x += glyphBefore(p, m, prov.run, t) - glyphBefore(p, m, prov.run, from) + p.spacingPrefix[t]! - p.spacingPrefix[from]!
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
  wantTrimmable: boolean, priorityIn: number): Measured {
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
        const pendingAdvance = advance(p, m, prov, pending, i)
        const trimmableAdvance = trimmableChars > 0 ? advance(p, m, prov, trimStart, i) : 0
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
  if (!aborted) width += advance(p, m, prov, pending, end)
  let trimmableAdvance = trimmableChars > 0 ? advance(p, m, prov, trimStart, scanEnd) : 0
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
    charsFit, advance: advance(p, m, prov, aStart, aStart + charsFit), trimmableChars, trimmableAdvance, usedHyphenation,
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
  advance: number
  width: number
  nonEmpty: boolean
  usedHyphenation: boolean
  brokeText: boolean
  trimmedTrailingWhitespace: boolean
  trimmableChars: number
  status: 'complete' | 'break-before' | 'break-after'
  incomplete: boolean
  endsInNewline: boolean
  prov: Provider | null
}

// nsTextFrame::ReflowText (nsTextFrame.cpp:10847-11532).
function reflowText(p: GeckoPrepared, m: Measurer, ll: LineLayout, fi: number, contentStart: number): FrameResult {
  const f = p.frames[fi]!
  const run = p.textRuns[f.textRun]!
  const style = p.style
  const maxContentLength = f.end - contentStart
  const empty = (offset: number): FrameResult => ({
    frame: fi, contentStart, offset, length: 0, charsFit: 0, contentLength: maxContentLength, advance: 0, width: 0,
    nonEmpty: false, usedHyphenation: false, brokeText: false, trimmedTrailingWhitespace: false, trimmableChars: 0,
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
  computeTabs(p, m, prov, tOffset + tLength, ll.x)
  const r = breakAndMeasureText(p, m, prov, tOffset, tLength, availWidth, ll.totalPlaced > 0 ? 'none' : 'initial',
    style.wordCanWrap, style.wrap, style.isBreakSpaces, canTrim || style.whitespaceCanHang, ll.lastOptPriority)
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
  if (trimmable > 0) {
    if (canTrim) {
      if (brokeText) {
        trimmedTrailingWhitespace = true
        adv -= trimmable
        trimmable = 0
      }
    } else if (style.whitespaceCanHang) {
      const hang = Math.min(Math.max(0, adv - availWidth), trimmable)
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
    frame: fi, contentStart, offset, length, charsFit, contentLength, advance: adv, width, nonEmpty, usedHyphenation,
    brokeText, trimmedTrailingWhitespace, trimmableChars: r.trimmableChars, status,
    incomplete: contentLength !== maxContentLength, endsInNewline, prov,
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

type Pass = { redo: boolean; placed: FrameResult[]; nextPos: number; ll: LineLayout }

// nsBlockFrame::DoReflowInlineFrames (nsBlockFrame.cpp:5232-5476) over the frames from `pos`.
function reflowPass(p: GeckoPrepared, m: Measurer, pos: number, avail: number, force: LineLayout['force']): Pass {
  const ll: LineLayout = {
    avail, x: 0, totalPlaced: 0, lineIsEmpty: true, lineAtStart: true, trimmableISize: 0, needBackup: false,
    lastOpt: null, lastOptPriority: NO_BREAK, force,
  }
  const placed: FrameResult[] = []
  let nextPos = p.text.length
  let fi = 0
  while (fi < p.frames.length && p.frames[fi]!.end <= pos) fi++
  for (let first = true; fi < p.frames.length; fi++, first = false) {
    const f = p.frames[fi]!
    const contentStart = first ? Math.max(pos, f.start) : f.start
    const notSafeToBreak = ll.lineIsEmpty
    const r = reflowText(p, m, ll, fi, contentStart)
    if (r.status === 'break-before') { // nsLineLayout.cpp:1081-1084, nsBlockFrame.cpp:5547-5566
      nextPos = contentStart
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
  return { redo, placed, nextPos, ll }
}

// nsBlockFrame::ReflowInlineFrames (nsBlockFrame.cpp:5123-5199): one redo with the saved break forced.
function reflowLine(p: GeckoPrepared, m: Measurer, pos: number, avail: number): Pass {
  const pass = reflowPass(p, m, pos, avail, null)
  if (!pass.redo) return pass
  return reflowPass(p, m, pos, avail, pass.ll.lastOpt)
}

// Everything from `pos` lays out to nothing: characters without a frame, skipped by TransformText, or trimmable white
// space a line start skips.
function restIsEmpty(p: GeckoPrepared, pos: number): boolean {
  for (let s = pos; s < p.text.length; s++) {
    if (p.frames.length === 0 || p.frames[frameOfSource(p.frames, s)]!.start > s || p.frames[frameOfSource(p.frames, s)]!.end <= s) continue
    if (p.sourceT[s] === -1) continue
    const f = p.frames[frameOfSource(p.frames, s)]!
    // A significant newline is kept at a line start (nsTextFrame.cpp:10935-10951 skips white space before it only).
    if (p.style.newlineIsSignificant && p.text.charCodeAt(s) === 0x0a) return false
    if (!p.style.whiteSpaceIsSignificant && isTrimmableChar(p.text, s, f.end, f.is8bit)) continue
    return false
  }
  return true
}

export function firstGeckoLine(p: GeckoPrepared): GeckoLineStart | null {
  return restIsEmpty(p, 0) ? null : { engine: 'gecko', contentOffset: 0 }
}

export function nextGeckoLine(p: GeckoPrepared, start: GeckoLineStart, availableWidth: number, m: Measurer): LineOf<GeckoLineStart> {
  const avail = pxToAu(availableWidth)
  let pos = start.contentOffset
  let pass = reflowLine(p, m, pos, avail)
  const emptyPrefix: FrameResult[] = []
  // A pass whose frames all collapsed places an empty line box, which has no height; its content joins the next line.
  while (!pass.placed.some(r => r.nonEmpty) && pass.nextPos < p.text.length && !restIsEmpty(p, pass.nextPos)) {
    if (pass.nextPos <= pos) throw new Error(`gecko: no progress at ${pos}`)
    for (let k = 0; k < pass.placed.length; k++) emptyPrefix.push(pass.placed[k]!)
    pos = pass.nextPos
    pass = reflowLine(p, m, pos, avail)
  }
  if (pass.nextPos <= pos) throw new Error(`gecko: no progress at ${pos}`)
  const end = pass.nextPos >= p.text.length || restIsEmpty(p, pass.nextPos) ? p.text.length : pass.nextPos
  return buildLine(p, m, start.contentOffset, end, pass.placed, end === p.text.length ? null : { engine: 'gecko', contentOffset: end })
}

// TrimTrailingWhiteSpace, fragments and the visible width of the final pass (nsLineLayout.cpp:2851-2985,
// nsTextFrame.cpp:11540-11628).
function buildLine(p: GeckoPrepared, m: Measurer, lineStart: number, lineEnd: number, placed: FrameResult[],
  next: GeckoLineStart | null): LineOf<GeckoLineStart> {
  const style = p.style
  const fragments: Fragment[] = []
  const runOf = (s: number): number => {
    let r = 0
    while (p.runStarts[r + 1]! <= s) r++
    return r
  }
  // Trailing white space at the line end: trimmed in collapsing modes, hanging under pre-wrap. The lab's visible
  // extent leaves out trailing SPACE and TAB under normal, nowrap, pre-line and pre-wrap (lab/README.md "Visible code
  // points").
  const trailing = new Set<number>()
  const trimsTrailing = style.collapse === 'collapse' || style.collapse === 'preserve-breaks'
  const hangsTrailing = style.collapse === 'preserve' && style.wrap
  if (trimsTrailing || hangsTrailing) {
    outer: for (let k = placed.length - 1; k >= 0; k--) {
      const r = placed[k]!
      const end = r.contentStart + r.contentLength
      for (let s = end - 1; s >= r.offset; s--) {
        const t = p.sourceT[s]!
        if (t === -1) continue
        const ch = p.tUnits[t]!
        const f = p.frames[r.frame]!
        const trims = trimsTrailing && (isTrimmableChar(p.text, s, f.end, f.is8bit) || ch === 0x20 ||
          (r.trimmedTrailingWhitespace && p.isSpace[t] === 1))
        const hangs = hangsTrailing && (ch === 0x20 || ch === 0x09)
        if (!trims && !hangs) break outer
        trailing.add(s)
      }
    }
  }
  let widthAu = 0
  let lastT = -1
  for (let s = lineStart; s < lineEnd;) {
    const inPlaced = placed.find(r => s >= r.contentStart && s < r.contentStart + r.contentLength)
    if (inPlaced === undefined) {
      let e = s + 1
      while (e < lineEnd && placed.find(r => e >= r.contentStart && e < r.contentStart + r.contentLength) === undefined) e++
      pushCollapsed(fragments, runOf, s, e)
      s = e
      continue
    }
    const r = inPlaced
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
    const isTrailing = trailing.has(s)
    let e = s + 1
    while (e < contentEnd && p.sourceT[e] !== -1 && trailing.has(e) === isTrailing &&
      !(r.endsInNewline && e === contentEnd - 1 && p.tUnits[p.sourceT[e]!] === 0x0a)) e++
    const tEnd = p.sourceT[e - 1]! + 1
    let painted = ''
    for (let k = t; k < tEnd; k++) painted += String.fromCharCode(p.tUnits[k]!)
    const prov = r.prov!
    const w = advance(p, m, prov, t, tEnd)
    if (!isTrailing) {
      fragments.push({ kind: 'text', run: f.run, start: s, end: e, painted, width: w / 60, level: f.level })
      widthAu += w
    } else if (hangsTrailing) {
      fragments.push({ kind: 'hanging', run: f.run, start: s, end: e, painted, width: w / 60, level: f.level })
    } else {
      fragments.push({ kind: 'trimmed', run: f.run, start: s, end: e, painted, level: f.level })
    }
    lastT = tEnd
    s = e
  }
  // The hyphen of a used soft hyphen follows the frame's last fragment; its advance joins the frame width without
  // letter spacing (AddHyphenToMetrics, nsTextFrame.cpp:6829-6845).
  for (let k = 0; k < placed.length; k++) {
    const r = placed[k]!
    if (!r.usedHyphenation) continue
    const f = p.frames[r.frame]!
    const run = p.textRuns[f.textRun]!
    const at = r.contentStart + r.contentLength
    let index = fragments.length
    while (index > 0 && fragments[index - 1]!.kind !== 'hyphen' && (fragments[index - 1] as { start: number }).start >= at) index--
    fragments.splice(index, 0, { kind: 'hyphen', run: f.run, at, painted: '‐', letterSpacing: 0, width: run.hyphenAu / 60, level: f.level })
    widthAu += run.hyphenAu
  }
  // The paragraph shaped letters on both sides of this break inside one word: the painter keeps their joining forms.
  let joinsNextLine = false
  if (next !== null && lastT > 0 && lastT < p.tUnits.length && p.unitOf[lastT - 1] === p.unitOf[lastT] &&
    p.units[p.unitOf[lastT]!]!.kind === 'word') {
    let a = lastT - 1
    while (a > 0 && joiningType(p.tUnits[a]!) === 'T') a--
    let b = lastT
    while (b + 1 < p.tUnits.length && joiningType(p.tUnits[b]!) === 'T') b++
    const left = joiningType(p.tUnits[a]!)
    const right = joiningType(p.tUnits[b]!)
    joinsNextLine = (left === 'D' || left === 'L' || left === 'C') && (right === 'D' || right === 'R' || right === 'C')
  }
  // Gecko's line box width: placed frame widths less the trailing white space TrimTrailingWhiteSpaceIn removes from the
  // last frame that has content (nsLineLayout.cpp:2851-2985, nsTextFrame.cpp:11540-11628).
  let lineBoxAu = 0
  const trimmedEnds = new Map<number, number>()
  const trimDeltas = new Map<number, number>()
  for (let k = 0; k < placed.length; k++) lineBoxAu += placed[k]!.width
  for (let k = placed.length - 1; k >= 0; k--) {
    const r = placed[k]!
    const f = p.frames[r.frame]!
    const contentEnd = r.contentStart + r.contentLength
    let changed = false
    if (!style.whiteSpaceIsSignificant && !r.trimmedTrailingWhitespace && r.prov !== null) {
      let trimmedEnd = contentEnd
      while (trimmedEnd > r.offset && isTrimmableChar(p.text, trimmedEnd - 1, f.end, f.is8bit)) trimmedEnd--
      trimmedEnds.set(k, trimmedEnd)
      const tA = Math.min(p.nextT[trimmedEnd]!, f.tEnd)
      const tB = Math.min(p.nextT[contentEnd]!, f.tEnd)
      if (tA < tB) {
        const delta = Math.floor(advance(p, m, r.prov, tA, tB))
        lineBoxAu -= delta
        trimDeltas.set(k, delta)
        changed = true
      }
    }
    if (r.nonEmpty || changed) break
  }
  // The width the lab observes: the extent of the line's visible code points, which aren't default-ignorable, controls
  // other than TAB or separators, nor SPACE or TAB in the trailing run under a mode where white space hangs; the trailing
  // run stops at an inked character, a no-break space or another control (lab/README.md "Visible code points").
  const hangs = style.collapse === 'collapse' || style.collapse === 'preserve-breaks' || (style.collapse === 'preserve' && style.wrap)
  const kept: number[] = []
  for (let k = 0; k < placed.length; k++) {
    const r = placed[k]!
    // A frame that broke inside itself already removed its trailing "is space" characters from its width, U+3000 included
    // (nsTextFrame.cpp:11203-11213): they have no advance on the line.
    // White space TrimTrailingWhiteSpace removed has no advance either.
    let end = trimmedEnds.get(k) ?? r.contentStart + r.contentLength
    if (r.trimmedTrailingWhitespace) {
      for (let removed = 0; removed < r.trimmableChars && end > r.offset; end--) if (p.sourceT[end - 1] !== -1) removed++
    }
    for (let s = r.offset; s < end; s++) {
      const t = p.sourceT[s]!
      if (t === -1 || isLowSurrogateOfPair(p.text, s)) continue
      // A space, NBSP or invalid character whose advance isn't positive (a control, a space under negative word spacing)
      // has no positive rect, so it neither counts nor stops the trailing run.
      const unit = p.units[p.unitOf[t]!]!
      if (unit.kind !== 'word' && unit.au + p.spacingPrefix[t + 1]! - p.spacingPrefix[t]! + (r.prov?.tabs.get(t) ?? 0) <= 0) continue
      kept.push(s)
    }
  }
  let trailingStart = kept.length
  while (trailingStart > 0) {
    const cp = p.text.codePointAt(kept[trailingStart - 1]!)!
    if ((!isWhiteSpaceProperty(cp) && !isInvisible(cp)) || cp === 0xa0 || cp === 0x2007 || cp === 0x202f || isOtherControl(cp)) break
    trailingStart--
  }
  const visible = new Set<number>()
  for (let k = 0; k < kept.length; k++) {
    const cp = p.text.codePointAt(kept[k]!)!
    if (isInvisible(cp) && cp !== 0x09) continue
    if (hangs && k >= trailingStart && (cp === 0x20 || cp === 0x09)) continue
    visible.add(kept[k]!)
  }
  // Frames in visual order: UAX #9 L2 over the frames' levels, as nsBidiPresUtils::ReorderFrames orders a line
  // (nsBidiPresUtils.cpp:1494-1532, Bidi::ReorderVisual through unicode-bidi). An odd-level frame draws right to left.
  const order: number[] = []
  let maxLevel = 0
  let minLevel = 255
  for (let k = 0; k < placed.length; k++) {
    order.push(k)
    const level = p.frames[placed[k]!.frame]!.level
    maxLevel = Math.max(maxLevel, level)
    minLevel = Math.min(minLevel, level)
  }
  const lowestOdd = (minLevel & 1) === 1 ? minLevel : minLevel + 1
  for (let level = maxLevel; level >= lowestOdd; level--) {
    for (let i = 0; i < order.length;) {
      if (p.frames[placed[order[i]!]!.frame]!.level < level) { i++; continue }
      let j = i
      while (j < order.length && p.frames[placed[order[j]!]!.frame]!.level >= level) j++
      const reversed = order.slice(i, j).reverse()
      for (let q = 0; q < reversed.length; q++) order[i + q] = reversed[q]!
      i = j
    }
  }
  let x = 0
  let left = Infinity
  let right = -Infinity
  for (let v = 0; v < order.length; v++) {
    const k = order[v]!
    const r = placed[k]!
    const width = r.width - (trimDeltas.get(k) ?? 0)
    if (r.prov === null) continue
    const f = p.frames[r.frame]!
    const contentEnd = r.contentStart + r.contentLength
    let first = -1
    let last = -1
    for (let s = r.offset; s < contentEnd; s++) {
      if (!visible.has(s)) continue
      if (first < 0) first = s
      last = s
    }
    let v0 = -1
    let v1 = -1
    if (first >= 0) {
      v0 = advance(p, m, r.prov, r.prov.startT, Math.min(p.nextT[first]!, f.tEnd))
      v1 = advance(p, m, r.prov, r.prov.startT, Math.min(p.nextT[last + (p.text.codePointAt(last)! >= 0x10000 ? 2 : 1)]!, f.tEnd))
    }
    if (r.usedHyphenation) { // the hyphen span is inked and follows the frame's text
      if (v0 < 0) v0 = width - p.textRuns[f.textRun]!.hyphenAu
      v1 = width
    }
    if (v0 >= 0) {
      const even = (f.level & 1) === 0
      left = Math.min(left, x + (even ? v0 : width - v1))
      right = Math.max(right, x + (even ? v1 : width - v0))
    }
    x += width
  }
  // The lab takes the whole-node boxes (the line box) when no non-visible white space has a positive rect, else the
  // visible code points' own extent (lab/score.ts lineExtent); a line without a visible code point observes 0.
  let hangingInk = false
  for (let k = 0; k < kept.length; k++) if (!visible.has(kept[k]!) && isWhiteSpaceProperty(p.text.codePointAt(kept[k]!)!)) hangingInk = true
  let hyphenated = false
  for (let k = 0; k < placed.length; k++) if (placed[k]!.usedHyphenation) hyphenated = true
  const visibleAu = visible.size === 0 && !hyphenated ? 0 : !hangingInk ? lineBoxAu : right > left ? right - left : 0
  return {
    start: lineStart, end: lineEnd, width: visibleAu / 60, engineWidth: { unit: 'gecko-app-unit', au: lineBoxAu }, fragments,
    joinsNextLine, next,
  }
}

const isLowSurrogateOfPair = (text: string, s: number) => s > 0 && (text.charCodeAt(s) & 0xfc00) === 0xdc00 &&
  (text.charCodeAt(s - 1) & 0xfc00) === 0xd800

// White_Space (PropList.txt).
const isWhiteSpaceProperty = (cp: number) => (cp >= 0x09 && cp <= 0x0d) || cp === 0x20 || cp === 0x85 || cp === 0xa0 ||
  cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x2028 || cp === 0x2029 || cp === 0x202f || cp === 0x205f || cp === 0x3000

function isInvisible(cp: number): boolean {
  const gc = generalCategory(cp)
  return gc === 'Cc' || gc === 'Cf' || gc === 'Zl' || gc === 'Zp' || isDefaultIgnorable(cp)
}

const isOtherControl = (cp: number) => (cp <= 0x08) || cp === 0x0b || cp === 0x0c || (cp >= 0x0e && cp <= 0x1f) ||
  (cp >= 0x7f && cp <= 0x9f)

function pushCollapsed(fragments: Fragment[], runOf: (s: number) => number, start: number, end: number): void {
  for (let s = start; s < end;) {
    const run = runOf(s)
    let e = s + 1
    while (e < end && runOf(e) === run) e++
    fragments.push({ kind: 'collapsed', run, start: s, end: e })
    s = e
  }
}
