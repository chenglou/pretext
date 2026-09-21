// Content building for Gecko (Firefox 156.0): frames, bidi splits, text runs, TransformText per mapped flow, glyph
// flags, nsLineBreaker breaks, spacing and the app-unit advances known before lines are filled.
// specs/gecko-text.md §2-§12, specs/gecko-canvas.md §2-§3, specs/probes-firefox.md.
import { indexContent, styleUnder, type ContentIndex } from '../../content.js'
import type { GeckoEnvironment } from '../../env.js'
import { bounds, contextFor, width, type Context, type ContextPool } from '../../measure/canvas.js'
import { canvasFont } from '../../measure/font.js'
import type { BoxEdge, FontDecl, Paragraph, TextStyle } from '../../model.js'
import { geckoBidiData, geckoGraphemeRules } from './data.js'
import { COLOR_EMOJI_FAMILY, createFontDeclarations, extenderFontOf, listedFontOf, quantize10, sameFontForTextRun } from './fonts.js'
import * as gaps from './gaps.js'
import { canonicalLanguageTag } from './likely.js'
import { CANVAS_AU_PER_PX, NO_SCRIPT_GAPS, combine, isInvalidChar16, isInvalidChar8, isSurrogatePair, quantize7, rangeAu, runContextsFor, scriptAt, textRunScripts } from './measure.js'
import { graphemeBoundaries } from '../../unicode/grapheme.js'
import { resolveUnicodeBidi } from '../../unicode/unicode-bidi.js'
import {
  BREAK_EMERGENCY_WRAP, BREAK_NONE, BREAK_SKIP_SETTING_NO_BREAKS, BREAK_SUPPRESS_INITIAL, BREAK_SUPPRESS_INSIDE,
  LineBreakerState, type BreakSink,
} from './linebreak.js'
import {
  emojiPresentation, isAlphanumeric, isBidiControl, isClusterExtender, isClusterExtenderExcludingJoiners, isCursiveScript,
  isDefaultIgnorable, isEastAsianPunctuation, isFormatCategory, isSegmentBreakSkipChar, isUtf16CodeUnitBidi,
} from './props.js'
import {
  KIND_FORMAT, KIND_GLYPH, KIND_INVISIBLE, KIND_NEWLINE, KIND_TAB, objectAt, spanAt, type GeckoElement, type GeckoFrame,
  type GeckoItem, type GeckoInspect, type GeckoLeaf, type GeckoPrepared, type GeckoSpanEdges, type GeckoStyle, type GeckoTextRun, type GeckoUnit,
  type RunContexts, type ScriptRun,
} from './types.js'

const f32 = Math.fround
const SHY = 0x00ad

// NS_lroundf (nsMathUtils.h:31-33) on a float32 value.
export function lroundf(x: number): number {
  return x >= 0 ? Math.trunc(f32(x + 0.5)) : Math.trunc(f32(x - 0.5))
}

// StyleCSSPixelLength::ToAppUnits: NSToIntRound(float(px) × 60f) (ServoStyleConstsInlines.h:584-595).
export const pxToAu = (px: number): number => lroundf(f32(f32(px) * 60))

export function geckoStyle(s: TextStyle): GeckoStyle {
  let collapse: GeckoStyle['collapse']
  let wrap: boolean
  switch (s.whiteSpace) {
    case 'normal': collapse = 'collapse'; wrap = true; break
    case 'nowrap': collapse = 'collapse'; wrap = false; break
    case 'pre': collapse = 'preserve'; wrap = false; break
    case 'pre-wrap': collapse = 'preserve'; wrap = true; break
    case 'pre-line': collapse = 'preserve-breaks'; wrap = true; break
    case 'break-spaces': collapse = 'break-spaces'; wrap = true; break
  }
  const overflowWrap = s.wordBreak === 'break-word' ? 'anywhere' : s.overflowWrap // nsStyleStruct.h:1303-1315
  let wordBreak: GeckoStyle['wordBreak']
  switch (s.wordBreak) {
    case 'break-word': case 'normal': wordBreak = 'normal'; break
    case 'break-all': wordBreak = 'break-all'; break
    case 'keep-all': wordBreak = 'keep-all'; break
  }
  return {
    collapse,
    wrap,
    whiteSpaceIsSignificant: collapse !== 'collapse' && collapse !== 'preserve-breaks',
    newlineIsSignificant: collapse === 'preserve' || collapse === 'preserve-breaks' || collapse === 'break-spaces',
    whitespaceCanHang: wrap && collapse !== 'break-spaces',
    wordCanWrap: wrap && (overflowWrap === 'break-word' || overflowWrap === 'anywhere'),
    isBreakSpaces: collapse === 'break-spaces',
    wordBreak,
    lineBreak: s.lineBreak,
    tabSize: s.tabSize,
  }
}

// nsContentUtils::IsHyphen (nsContentUtils.cpp:2257-2265).
const isHyphen = (u: number) => u === 0x2d || u === 0x2010 || u === 0x2012 || u === 0x2013 || u === 0x058a

// nsTextFrameUtils::IsSpaceCombiningSequenceTail (nsTextFrameUtils.cpp:24-30), over code units.
function isSpaceCombiningSequenceTail(text: string, from: number, end: number): boolean {
  for (let i = from; i < end; i++) {
    const u = text.charCodeAt(i)
    if (isClusterExtenderExcludingJoiners(u)) return true
    if (!isBidiControl(u)) return false
  }
  return false
}

// IsTrimmableSpace over the node's characters (nsTextFrame.cpp:904-919): what GetTrimmableWhitespaceCount counts.
export function isTrimmableChar(text: string, pos: number, nodeEnd: number, is8bit: boolean): boolean {
  const ch = text.charCodeAt(pos)
  if (is8bit) return ch === 0x20 || ch === 0x09 || ch === 0x0c || ch === 0x0a || ch === 0x0d
  if (ch === 0x20 || ch === 0x1680) return !isSpaceCombiningSequenceTail(text, pos + 1, nodeEnd)
  return ch === 0x09 || ch === 0x0c || ch === 0x0a || ch === 0x0d
}

// IsTrimmableSpace with the style (nsTextFrame.cpp:921-942), used by HasCompressedLeadingWhitespace.
function isTrimmableSpaceStyled(text: string, pos: number, nodeEnd: number, style: GeckoStyle): boolean {
  switch (text.charCodeAt(pos)) {
    case 0x20: case 0x1680: return !style.whiteSpaceIsSignificant && !isSpaceCombiningSequenceTail(text, pos + 1, nodeEnd)
    case 0x0a: return !style.newlineIsSignificant
    case 0x09: case 0x0d: case 0x0c: return !style.whiteSpaceIsSignificant
    default: return false
  }
}

// nsTextFrameUtils::TransformText for one mapped flow [start, end) of a node (nsTextFrameUtils.cpp:211-401, helper
// TransformWhiteSpaces :84-209). Returns the carried in-white-space bit.
type TransformOut = {
  tUnits: Uint16Array; tSource: Int32Array; sourceT: Int32Array; count: number; hasShy: boolean; hasTab: boolean
}
function transformFlow(text: string, start: number, end: number, is8bit: boolean, style: GeckoStyle, inWhitespace: boolean,
  lang: string, out: TransformOut): boolean {
  const keep = (s: number, ch: number): void => {
    out.tUnits[out.count] = ch
    out.tSource[out.count] = s
    out.sourceT[s] = out.count
    out.count++
  }
  const discardable = (ch: number): boolean => {
    if (ch === SHY) { out.hasShy = true; return true }
    return !is8bit && isBidiControl(ch)
  }
  if (style.collapse === 'preserve' || style.collapse === 'break-spaces') {
    // COMPRESS_NONE: the newline is significant (nsTextFrame.cpp:1335-1354).
    for (let i = start; i < end; i++) {
      const ch = text.charCodeAt(i)
      if (discardable(ch)) continue
      if (ch === 0x09) out.hasTab = true
      keep(i, ch)
    }
    return false
  }
  const preserveBreaks = style.collapse === 'preserve-breaks' // COMPRESS_WHITESPACE
  const jaZh = lang.length >= 2 && (lang.slice(0, 2).toLowerCase() === 'ja' || lang.slice(0, 2).toLowerCase() === 'zh') &&
    (lang.length === 2 || lang[2] === '-')
  const isWS = (ch: number) => ch === 0x20 || ch === 0x09 || ch === 0x0a
  let inWs = inWhitespace
  const transformWhiteSpaces = (b: number, e: number, hasSegmentBreak: boolean): void => {
    let skippable = false
    if (!is8bit) {
      if ((b > start && text.charCodeAt(b - 1) === 0x200b) || (e < end && text.charCodeAt(e) === 0x200b)) {
        skippable = true
      } else if (b > start && e < end) {
        let before = 0
        let pos = b
        do {
          if (pos > start + 1 && isSurrogatePair(text.charCodeAt(pos - 2), text.charCodeAt(pos - 1))) {
            before = combine(text.charCodeAt(pos - 2), text.charCodeAt(pos - 1))
            pos -= 2
          } else {
            before = text.charCodeAt(pos - 1)
            pos -= 1
          }
        } while (isDefaultIgnorable(before) && pos > start)
        let after = 0
        pos = e
        do {
          if (pos + 1 < end && isSurrogatePair(text.charCodeAt(pos), text.charCodeAt(pos + 1))) {
            after = combine(text.charCodeAt(pos), text.charCodeAt(pos + 1))
            pos += 2
          } else {
            after = text.charCodeAt(pos)
            pos += 1
          }
        } while (isDefaultIgnorable(after) && pos < end)
        skippable = (isSegmentBreakSkipChar(before) && isSegmentBreakSkipChar(after)) ||
          (jaZh && (isEastAsianPunctuation(before) || isEastAsianPunctuation(after)))
      }
    }
    for (let i = b; i < e; i++) {
      const ch = text.charCodeAt(i)
      if (discardable(ch)) continue
      if (ch === 0x20 || ch === 0x09) {
        if (hasSegmentBreak || inWs) continue
        keep(i, 0x20)
        inWs = true
        continue
      }
      // A segment break (LF).
      if (preserveBreaks) {
        keep(i, ch)
        inWs = false
        continue
      }
      if (skippable || inWs) continue
      skippable = true
      keep(i, 0x20)
      inWs = true
    }
  }
  for (let i = start; i < end; i++) {
    const ch = text.charCodeAt(i)
    if (!isWS(ch) && !(ch === SHY || (!is8bit && isBidiControl(ch)))) {
      keep(i, ch)
      inWs = false
      continue
    }
    if (isWS(ch)) {
      let keepLastSpace = false
      let hasSegmentBreak = ch === 0x0a
      let j = i + 1
      for (; j < end && (isWS(text.charCodeAt(j)) || text.charCodeAt(j) === SHY || (!is8bit && isBidiControl(text.charCodeAt(j)))); j++) {
        if (text.charCodeAt(j) === 0x0a) hasSegmentBreak = true
      }
      let trailingDiscardables = 0
      for (; text.charCodeAt(j - 1) === SHY || (!is8bit && isBidiControl(text.charCodeAt(j - 1))); j--) trailingDiscardables++
      if (!is8bit && text.charCodeAt(j - 1) === 0x20 && j < end && isSpaceCombiningSequenceTail(text, j, end)) {
        keepLastSpace = true
        j--
      }
      if (j > i) transformWhiteSpaces(i, j, hasSegmentBreak)
      if (keepLastSpace) {
        keep(j, 0x20)
        j++
      }
      for (; trailingDiscardables > 0; trailingDiscardables--) {
        discardable(text.charCodeAt(j))
        j++
      }
      i = j - 1
      continue
    }
    discardable(ch)
    inWs = false
  }
  return inWs
}

// Glyph flags a text run records while it is shaped (gfxFont::SplitAndInitTextRun, gfxShapedText::
// SetupClusterBoundaries, gfxFontGroup::InitTextRun; gfxFont.cpp:708-795, :3708-3900, gfxTextRun.cpp:2673-2831).
type Glyphs = { units: Uint16Array; breakFlags: Uint8Array; clusterStart: Uint8Array; isSpace: Uint8Array; kind: Uint8Array }

function extendCluster(g: Glyphs, i: number): void {
  g.breakFlags[i] = BREAK_NONE
  g.clusterStart[i] = 0
  g.isSpace[i] = 0
}

function zeroGlyphs(g: Glyphs, from: number, to: number): void {
  for (let i = from; i < to; i++) {
    g.breakFlags[i] = BREAK_NONE
    g.clusterStart[i] = 1
    g.isSpace[i] = 0
    g.kind[i] = KIND_GLYPH
  }
}

function setupClusterBoundaries16(g: Glyphs, from: number, to: number): void {
  const len = to - from
  if (len === 0) return
  let ch0 = g.units[from]!
  if (len > 1 && isSurrogatePair(ch0, g.units[from + 1]!)) ch0 = combine(ch0, g.units[from + 1]!)
  if (isClusterExtender(ch0)) extendCluster(g, from)
  let word = ''
  for (let i = from; i < to; i++) word += String.fromCharCode(g.units[i]!)
  const boundaries = graphemeBoundaries(word, geckoGraphemeRules)
  let next = 1
  let pos = 0
  let prevWasHyphen = false
  while (pos < len) {
    const ch = g.units[from + pos]!
    if (prevWasHyphen) {
      if (isAlphanumeric(ch)) g.breakFlags[from + pos] = BREAK_EMERGENCY_WRAP
      prevWasHyphen = false
    }
    if (ch === 0x20 || ch === 0x3000) g.isSpace[from + pos] = 1
    else if (isHyphen(ch) && pos > 0 && isAlphanumeric(g.units[from + pos - 1]!)) prevWasHyphen = true
    else if (ch === 0x09af && pos > 0 && g.units[from + pos - 1] === 0x09cd) extendCluster(g, from + pos)
    const nextPos = boundaries[next++]!
    pos++
    for (; pos < nextPos; pos++) extendCluster(g, from + pos)
  }
}

function setupClusterBoundaries8(g: Glyphs, from: number, to: number): void {
  let prevWasHyphen = false
  for (let pos = from; pos < to; pos++) {
    const ch = g.units[pos]! & 0xff
    if (prevWasHyphen) {
      if (isAlphanumeric(ch)) g.breakFlags[pos] = BREAK_EMERGENCY_WRAP
      prevWasHyphen = false
    }
    if (ch === 0x20) g.isSpace[pos] = 1
    else if (ch === 0x2d && pos > from && isAlphanumeric(g.units[pos - 1]!)) prevWasHyphen = true
  }
}

function setupWord(g: Glyphs, from: number, to: number, as8bit: boolean): void {
  zeroGlyphs(g, from, to) // a shaped word starts from fresh glyph records (gfxFont.h:1459)
  if (as8bit) setupClusterBoundaries8(g, from, to)
  else setupClusterBoundaries16(g, from, to)
}

const WORD_CACHE_CHAR_LIMIT = 32 // gfx.font_rendering.wordcache.charlimit (StaticPrefList.yaml:7931-7934)

// A shaping unit as SplitAndInitTextRun cuts it (GeckoUnit), before step 7 measures it.
type UnitRange = Pick<GeckoUnit, 'kind' | 'tStart' | 'tEnd'>

function splitAndInitTextRun(g: Glyphs, runStart: number, runLen: number, run8bit: boolean, out: UnitRange[], runScript: ScriptRun): void {
  if (runLen === 0) return
  let wordStart = 0
  let wordIs8bit = true
  let nextCh = g.units[runStart]!
  let gapStart = -1
  let contextGaps: number[] | null = null
  const needsContext = runScript.script !== 'Zyyy' && runScript.script !== 'Zinh' && runScript.script !== 'Zzzz'
  for (let i = 0; i <= runLen; i++) {
    const t = runStart + i
    // Context witnesses read the complete transformed text, including a pair split across text runs, just as rangeAu.
    const mismatch = i < runLen && needsContext && scriptAt(g.units, t, g.units.length) !== runScript.script
    if (mismatch) {
      if (gapStart < 0) gapStart = t
    } else if (gapStart >= 0) {
      ;(contextGaps ??= []).push(gapStart, t)
      gapStart = -1
    }
    const ch = nextCh
    nextCh = i + 1 < runLen ? g.units[runStart + i + 1]! : 0x0a
    const boundary = (ch === 0x20 || ch === 0xa0) && (run8bit || !isClusterExtender(nextCh)) // IsBoundarySpace :3317-3330
    const invalid = !boundary && (run8bit ? isInvalidChar8(ch) : isInvalidChar16(ch))
    const length = i - wordStart
    if (!boundary && !invalid) {
      if (ch >= 0x100) wordIs8bit = false
      continue
    }
    if (length > WORD_CACHE_CHAR_LIMIT) setupWord(g, runStart + wordStart, runStart + i, run8bit) // :3569-3577
    else if (length > 0) setupWord(g, runStart + wordStart, runStart + i, run8bit || wordIs8bit) // :3817-3821
    if (length > 0) out.push({ kind: 'word', tStart: runStart + wordStart, tEnd: runStart + i })
    if (boundary) { // SetSpaceGlyphIfSimple (gfxTextRun.cpp:1612-1619), NBSP shaped as its own word
      g.breakFlags[runStart + i] = BREAK_NONE
      g.clusterStart[runStart + i] = 1
      g.isSpace[runStart + i] = ch === 0x20 ? 1 : 0
      g.kind[runStart + i] = KIND_GLYPH
      out.push({ kind: ch === 0x20 ? 'space' : 'nbsp', tStart: runStart + i, tEnd: runStart + i + 1 })
      wordStart = i + 1
      wordIs8bit = true
      continue
    }
    if (i === runLen) break
    zeroGlyphs(g, runStart + i, runStart + i + 1) // gfxFont.cpp:3872-3897
    g.kind[runStart + i] = ch === 0x09 ? KIND_TAB : ch === 0x0a ? KIND_NEWLINE : isFormatCategory(ch) ? KIND_FORMAT : KIND_INVISIBLE
    out.push({ kind: 'invalid', tStart: runStart + i, tEnd: runStart + i + 1 })
    wordStart = i + 1
    wordIs8bit = true
  }
  runScript.contextGaps = contextGaps === null ? NO_SCRIPT_GAPS : new Int32Array(contextGaps)
}

// gfxFontGroup::InitTextRun shapes each script run on its own (gfxTextRun.cpp:2779-2809), so no shaped word crosses a
// script run limit. `scriptRuns` are the text run's (measure.ts textRunScripts); the units it is cut into go to `out`.
function initTextRun(g: Glyphs, start: number, end: number, is8bit: boolean, scriptRuns: ScriptRun[], out: UnitRange[]): void {
  if (end === start) return
  let runStart = start
  for (let k = 0; k < scriptRuns.length; k++) {
    splitAndInitTextRun(g, runStart, scriptRuns[k]!.limit - runStart, is8bit, out, scriptRuns[k]!)
    runStart = scriptRuns[k]!.limit
  }
  g.clusterStart[start] = 1
}

// ReplaceSeparators (nsBidiPresUtils.cpp:861-875).
function replaceSeparators(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const u = text.charCodeAt(i)
    out += u === 0x09 || u === 0x0a || u === 0x0b || u === 0x0d || (u >= 0x1c && u <= 0x1f) || u === 0x85 || u === 0x2029
      ? ' ' : text[i]
  }
  return out
}

// gfxFont::SynthesizeSpaceWidth (gfxFont.cpp:4792-4826): the em divisor of a Unicode space Gecko synthesizes from the
// font size, or 0. U+2007 and U+2008 take the font's digit and space widths instead, which the port doesn't correct.
function synthesizedSpaceDivisor(cp: number): number {
  switch (cp) {
    case 0x2000: case 0x2002: return 2
    case 0x2001: case 0x2003: case 0x3000: return 1
    case 0x2004: return 3
    case 0x2005: return 4
    case 0x2006: return 6
    case 0x2009: case 0x202f: return 5
    case 0x200a: return 10
    default: return 0
  }
}

// gfxFont::GetSyntheticBoldOffset (gfxFont.h:1899-1904), in device px of the font's size.
const syntheticBoldOffset = (size: number): number => size < 48 ? 0.25 + 0.75 * size / 48 : size / 48

// The first and the last of the block's DOM children, for the white-space-only text node rule: the leaf, or null where the
// child is an element or the block has none. A leaf with empty text makes no node.
function boundaryLeaves(index: ContentIndex<FontDecl>): { first: number | null; last: number | null } {
  let first: number | null = null
  let last: number | null = null
  let children = 0
  for (let e = 0; e < index.events.length; e++) {
    const event = index.events[e]!
    let leaf: number | null = null
    if (event.kind === 'text') {
      const indexed = index.leaves[event.run]!
      if (indexed.parent !== -1 || indexed.text.length === 0) continue
      leaf = event.run
    } else if (event.kind === 'close' || index.elements[event.element]!.parent !== -1) {
      continue
    }
    if (children++ === 0) first = leaf
    last = leaf
  }
  return { first, last }
}

// snap_as_border_width (servo/components/style/values/specified/border.rs:235-246): a nonzero border width rounds down to
// whole device pixels, and to at least one.
function borderAu(px: number, apd: number): number {
  const au = pxToAu(px)
  return au === 0 ? 0 : Math.max(apd, Math.trunc(au / apd) * apd)
}

// `inspect` prepares the paragraph for inspectLine and paragraphGaps: its gaps go to `sink`, with the measuring only they
// need (gaps.ts). A plain paragraph has no sink.
export function prepareGecko(paragraph: Paragraph, env: GeckoEnvironment, inspect: boolean, contexts: ContextPool): GeckoPrepared {
  const blockStyle = geckoStyle(paragraph)
  const apd = Math.max(1, Math.floor(60 / env.devicePixelRatio + 0.5)) // nsDeviceContext.cpp:52-63
  const index = indexContent(paragraph)
  const text = index.text
  const n = text.length
  const inspected: GeckoInspect | null = inspect ? { gaps: [], emergencyUnconfirmed: [] } : null
  const sink: gaps.GapSink = inspected === null ? null : inspected.gaps
  const leaves: GeckoLeaf[] = []
  const fontDeclarations = createFontDeclarations()
  // Language belongs to this document-order walk: null inherits, while an empty tag resets it.
  let inheritedLanguage = paragraph.lang
  const languages: string[] = []
  // No language below the final text event is consumed by this phase.
  const lastEvent = index.leaves.length === 0 ? -1 : index.leaves[index.leaves.length - 1]!.event
  for (let ev = 0; ev <= lastEvent; ev++) {
    const event = index.events[ev]!
    switch (event.kind) {
      case 'open': {
        const span = index.elements[event.element]!.node
        if (span.kind !== 'span') throw new Error(`open event ${event.element} is ${span.kind}`)
        languages.push(inheritedLanguage)
        if (span.lang !== null) inheritedLanguage = span.lang
        continue
      }
      case 'close': inheritedLanguage = languages.pop()!; continue
      case 'atomic': case 'br': case 'wbr': continue
      case 'text': break
    }
    const i = event.run
    const indexed = index.leaves[i]!
    const end = indexed.start + indexed.text.length
    // A text frame reads its parent element's computed style: a text node inherits every property the model has.
    const style = styleUnder(paragraph, index, indexed.parent)
    const lang = canonicalLanguageTag(inheritedLanguage)
    let is8bit = true
    for (let s = indexed.start; s < end; s++) if (text.charCodeAt(s) >= 0x100) { is8bit = false; break }
    leaves.push({
      start: indexed.start, end, parent: indexed.parent, style: geckoStyle(style), font: style.font, lang, is8bit,
      letterSpacingAu: pxToAu(style.letterSpacing), wordSpacingAu: pxToAu(style.wordSpacing),
    })
    // lang="" leaves the style language empty (MapLangAttributeInto, nsGenericHTMLElement.cpp:1337-1375), and nsFontCache gives
    // such text the locale language, the first regional-prefs locale lowercased (nsFontCache.cpp:34, :61-63;
    // nsLanguageAtomService.cpp:107-138), for font matching and shaping. Line breaking and TransformText still see the empty
    // tag. The measure contexts take that locale when the caller gives it; otherwise it can't be known.
    gaps.emptyLanguage(sink, env, lang, i, indexed.start, end)
  }

  // Elements: span box edges in au and the shaping boundary tests; atomic sizes (DESIGN.md §1.1, "Box edges").
  const elements: GeckoElement[] = []
  const rtlBlock = paragraph.direction === 'rtl'
  for (let e = 0; e < index.elements.length; e++) {
    const indexed = index.elements[e]!
    const node = indexed.node
    switch (node.kind) {
      case 'span': {
        const edges: GeckoSpanEdges = {
          startMargin: pxToAu(node.inlineStart.margin),
          startBorderPadding: borderAu(node.inlineStart.border, apd) + pxToAu(node.inlineStart.padding),
          endBorderPadding: borderAu(node.inlineEnd.border, apd) + pxToAu(node.inlineEnd.padding),
          endMargin: pxToAu(node.inlineEnd.margin),
        }
        const sideHasEdge = (edge: BoxEdge) => pxToAu(edge.margin) !== 0 || pxToAu(edge.padding) !== 0 || borderAu(edge.border, apd) !== 0
        const startEdge = sideHasEdge(node.inlineStart)
        const endEdge = sideHasEdge(node.inlineEnd)
        elements.push({
          kind: 'span', parent: indexed.parent, open: -1, close: -1, closes: [], style: geckoStyle(node), edges,
          breaksShapingAtStart: startEdge || node.verticalAlign !== 'baseline',
          breaksShapingAtEnd: endEdge || node.verticalAlign !== 'baseline',
          selfEmpty: !startEdge && !endEdge,
        })
        break
      }
      case 'atomic':
        elements.push({ kind: 'atomic', parent: indexed.parent, item: -1, iSize: pxToAu(node.width), startMargin: pxToAu(node.marginInlineStart), endMargin: pxToAu(node.marginInlineEnd), level: 0 })
        break
      case 'br':
      case 'wbr':
        elements.push({ kind: node.kind, parent: indexed.parent, item: -1, level: 0 })
        break
    }
  }

  // 1. Frames (nsCSSFrameConstructor.cpp:5220-5290, AtLineBoundary :5220-5258): a white-space-only 8-bit text node that is the
  //    block's first or last child gets no frame when white space and newlines aren't significant. A span's own child list
  //    has no line boundary.
  // `para`: the bidi paragraph the piece was resolved in (0 without bidi). `splitBefore`: the open spans split before it
  // (the bidi continuations of spans, below).
  type Piece = { run: number; start: number; end: number; level: number; para: number; splitBefore: boolean }
  const boundary = boundaryLeaves(index)
  let pieces: Piece[] = []
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]!
    if (leaf.end === leaf.start) continue
    if ((i === boundary.first || i === boundary.last) && leaf.style.collapse === 'collapse' && leaf.is8bit) {
      let onlyWhitespace = true
      for (let s = leaf.start; s < leaf.end; s++) {
        const u = text.charCodeAt(s)
        if (u !== 0x20 && u !== 0x09 && u !== 0x0a && u !== 0x0d && u !== 0x0c) { onlyWhitespace = false; break }
      }
      if (onlyWhitespace) continue
    }
    pieces.push({ run: i, start: leaf.start, end: leaf.end, level: 0, para: 0, splitBefore: false })
  }

  // 2. Bidi (nsBidiPresUtils.cpp:790-1167): resolve when the block is RTL or a 16-bit node has RTL characters; each
  //    preserved line is its own paragraph, and frames split where the level run ends.
  let resolveBidi = rtlBlock
  for (let k = 0; k < pieces.length && !resolveBidi; k++) {
    const p = pieces[k]!
    if (leaves[p.run]!.is8bit) continue
    for (let s = p.start; s < p.end; s++) if (isUtf16CodeUnitBidi(text.charCodeAt(s))) { resolveBidi = true; break }
  }
  if (!resolveBidi) for (let k = 0; k < pieces.length; k++) gaps.leftToRightControls(sink, text, pieces[k]!.run, pieces[k]!.start, pieces[k]!.end)
  let paraCount = 0
  // Per element: the bidi paragraph of an atomic inline, a <br> or a <wbr>.
  const elementPara = new Int32Array(elements.length)
  if (resolveBidi) {
    const split: Piece[] = []
    // TraverseFrames' paragraph buffer in document order (nsBidiPresUtils.cpp:1169-1429): each text piece's text, and one
    // character per other leaf, whose run gives that frame its level (ResolveParagraph :975-982, :1027). A <br> appends
    // U+2028 and ends the bidi paragraph (:1381-1384); an atomic inline is U+FFFC and a <wbr> U+200B (:1385-1400). An
    // inline-block is inline-outside, so it doesn't end the paragraph. A span without children would be a leaf as U+200B,
    // a boundary-neutral character that only gives the span its own level; the model gives empty spans no leaf.
    type Entry = { kind: 'text'; run: number; start: number; end: number } | { kind: 'object'; element: number }
    let chunk: Entry[] = []
    let chunkText = ''
    const flush = (): void => {
      if (chunk.length === 0) return
      const levels = resolveUnicodeBidi(replaceSeparators(chunkText), paragraph.direction, geckoBidiData).levels
      const para = paraCount++
      let offset = 0
      for (let c = 0; c < chunk.length; c++) {
        const entry = chunk[c]!
        if (entry.kind === 'object') {
          objectAt(elements, entry.element).level = levels[offset]!
          elementPara[entry.element] = para
          offset++
          continue
        }
        let s = entry.start
        for (let k = entry.start + 1; k < entry.end; k++) {
          if (levels[offset + k - entry.start] !== levels[offset + k - 1 - entry.start]) {
            split.push({ run: entry.run, start: s, end: k, level: levels[offset + s - entry.start]!, para, splitBefore: false })
            s = k
          }
        }
        split.push({ run: entry.run, start: s, end: entry.end, level: levels[offset + s - entry.start]!, para, splitBefore: false })
        offset += entry.end - entry.start
      }
      chunk = []
      chunkText = ''
    }
    // `pieces` holds the leaves with frames in document order, as their events come.
    let nextPiece = 0
    for (let ev = 0; ev < index.events.length; ev++) {
      const event = index.events[ev]!
      switch (event.kind) {
        case 'text': {
          if (nextPiece === pieces.length || pieces[nextPiece]!.run !== event.run) break
          const p = pieces[nextPiece++]!
          let s = p.start
          if (leaves[p.run]!.style.newlineIsSignificant) {
            for (let i = p.start; i < p.end; i++) {
              if (text.charCodeAt(i) !== 0x0a) continue
              chunk.push({ kind: 'text', run: p.run, start: s, end: i + 1 })
              chunkText += text.slice(s, i + 1)
              flush()
              s = i + 1
            }
          }
          if (s < p.end) {
            chunk.push({ kind: 'text', run: p.run, start: s, end: p.end })
            chunkText += text.slice(s, p.end)
          }
          break
        }
        case 'atomic':
          chunk.push({ kind: 'object', element: event.element })
          chunkText += '￼'
          break
        case 'br':
          chunk.push({ kind: 'object', element: event.element })
          chunkText += ' '
          flush()
          break
        case 'wbr':
          chunk.push({ kind: 'object', element: event.element })
          chunkText += '​'
          break
      }
    }
    flush()
    pieces = split
  }
  const leafPieces: Piece[][] = leaves.map(() => [])
  for (let k = 0; k < pieces.length; k++) leafPieces[pieces[k]!.run]!.push(pieces[k]!)

  // Bidi continuations of spans (ResolveParagraph, nsBidiPresUtils.cpp:1039-1057, :1114-1147; CreateContinuation and
  // SplitInlineAncestors :612-758): where two neighbouring leaves of one bidi paragraph differ in level, every span holding
  // both is split, after the spans that close behind the first leaf. A split inside a text node goes between its pieces.
  const splitBeforeEvent = new Uint8Array(index.events.length)
  if (resolveBidi) {
    let prevLevel = -1
    let prevPara = -1
    let insertAt = -1
    for (let ev = 0; ev < index.events.length; ev++) {
      const event = index.events[ev]!
      switch (event.kind) {
        case 'open':
          if (insertAt === -1) insertAt = ev
          break
        case 'close':
          break
        case 'text': {
          const list = leafPieces[event.run]!
          for (let k = 0; k < list.length; k++) {
            const piece = list[k]!
            if (prevPara === piece.para && prevLevel !== piece.level) {
              if (k > 0) piece.splitBefore = true
              else splitBeforeEvent[insertAt === -1 ? ev : insertAt] = 1
            }
            prevLevel = piece.level
            prevPara = piece.para
          }
          if (list.length > 0) insertAt = -1
          break
        }
        default: {
          const el = objectAt(elements, event.element)
          const para = elementPara[event.element]!
          if (prevPara === para && prevLevel !== el.level) splitBeforeEvent[insertAt === -1 ? ev : insertAt] = 1
          prevLevel = el.level
          prevPara = para
          insertAt = -1
        }
      }
    }
  }

  // 3. Items in document order, text runs (BuildTextRunsScanner::ScanFrame, nsTextFrame.cpp:2176-2276;
  //    ContinueTextRunAcrossFrames :2015-2174) and TransformText per mapped flow. Spans continue text runs and the line
  //    breaker (nsInlineFrame::CanContinueTextRun, nsInlineFrame.cpp:471-474); any other frame ends both
  //    (CanTextCrossFrameBoundary, nsTextFrame.cpp:1395-1431), clears the incoming white-space bit and flushes the line
  //    breaker, recording a trailing break on the run it flushes except before a <br> (:2246-2272, FlushLineBreaks
  //    :1835-1855).
  const tr: TransformOut = {
    tUnits: new Uint16Array(n), tSource: new Int32Array(n), sourceT: new Int32Array(n).fill(-1), count: 0, hasShy: false,
    hasTab: false,
  }
  const frames: GeckoFrame[] = []
  const items: GeckoItem[] = []
  // Every frame of a build is its own mapped flow: frames of one node only continue a text run as fluid continuations,
  // which line breaking makes later, and bidi splits don't continue one (nsTextFrame.cpp:2130-2139).
  type Flow = { frame: number; initialBreakController: number }
  // `scriptRuns` and `units`: the run's script runs and the shaping units it is cut into, which step 4 finds.
  type RunBuild = {
    flows: Flow[]; tStart: number; tEnd: number; is8bit: boolean; level: number; hasShy: boolean; hasTab: boolean; trailingBreak: boolean
    scriptRuns: ScriptRun[]; units: UnitRange[]
  }
  const builds: RunBuild[] = []
  // The line breaker's operations in document order: a text run's flows, or a reset with the run whose trailing break it
  // records (-1 for none).
  type BreakerOp = { kind: 'run'; build: number } | { kind: 'reset'; trailingOn: number }
  const breakerOps: BreakerOp[] = []
  let current: RunBuild | null = null
  let lastFrame = -1
  // mCommonAncestorWithLastFrame (nsTextFrame.cpp:1151-1156, :1886-1888, :2254-2275); -1 is the block, the line container
  // SetupBreakSinksForTextRun falls back to (:2956-2963).
  let commonAncestor = -1
  let inWhitespace = false
  const flushRun = (): void => {
    if (current === null) return
    builds.push(current)
    breakerOps.push({ kind: 'run', build: builds.length - 1 })
    current = null
    lastFrame = -1
  }
  // Whether `from` or an element below `ancestor` breaks shaping on its logical `side` (PreventCrossBoundaryShaping,
  // nsTextFrame.cpp:2054-2098). A text node itself has no box edges.
  const preventsShaping = (from: number, ancestor: number, side: 'start' | 'end'): boolean => {
    for (let e = from; e !== ancestor && e >= 0; e = elements[e]!.parent) {
      const el = elements[e]!
      if (el.kind === 'span' && (side === 'start' ? el.breaksShapingAtStart : el.breaksShapingAtEnd)) return true
    }
    return false
  }
  const ancestorsOf = (e: number): number[] => {
    const out: number[] = []
    for (let a = e; a >= 0; a = elements[a]!.parent) out.push(a)
    out.push(-1)
    return out
  }
  const continuesAcross = (prevFrame: GeckoFrame, p: Piece): boolean => {
    if (prevFrame.level !== p.level) return false
    const a = leaves[prevFrame.run]!
    const b = leaves[p.run]!
    if (a.style.newlineIsSignificant && text.charCodeAt(prevFrame.end - 1) === 0x0a) return false // HasTerminalNewline
    const parentA = a.parent
    const parentB = b.parent
    if (parentA !== parentB) {
      const up = ancestorsOf(parentA)
      let ancestor = -1
      const down = ancestorsOf(parentB)
      for (let k = 0; k < down.length; k++) if (up.includes(down[k]!)) { ancestor = down[k]!; break }
      // The inline end of the first frame's boxes and the inline start of the second's, swapped when the first frame's
      // embedding level is against the block's direction (nsTextFrame.cpp:2112-2126).
      const swap = ((prevFrame.level & 1) === 1) === !rtlBlock
      if (preventsShaping(parentA, ancestor, swap ? 'start' : 'end') || preventsShaping(parentB, ancestor, swap ? 'end' : 'start')) return false
    }
    if (prevFrame.run === p.run) return false // a non-fluid continuation of the same node (:2130-2139)
    if (parentA === parentB) return true // one computed style (:2141-2143)
    return a.style.wordBreak === b.style.wordBreak && a.style.lineBreak === b.style.lineBreak &&
      sameFontForTextRun(a.font, b.font, fontDeclarations) && a.lang === b.lang && (a.letterSpacingAu !== 0) === (b.letterSpacingAu !== 0)
  }
  let offsetAt = 0
  const openStack: number[] = []
  // A bidi split: the open spans' continuations end, innermost first, and new ones begin (SplitInlineAncestors). The scanner
  // lifts the common ancestor past each ended continuation as it does past a span (nsTextFrame.cpp:2275).
  const emitSplit = (at: number): void => {
    for (let d = openStack.length - 1; d >= 0; d--) {
      const e = openStack[d]!
      const el = spanAt(elements, e)
      el.closes.push(items.length)
      items.push({ kind: 'close', element: e, at, split: true })
      if (commonAncestor === e) commonAncestor = el.parent
    }
    for (let d = 0; d < openStack.length; d++) items.push({ kind: 'open', element: openStack[d]!, at, split: true })
  }
  for (let ev = 0; ev < index.events.length; ev++) {
    const event = index.events[ev]!
    if (splitBeforeEvent[ev] === 1) emitSplit(offsetAt)
    switch (event.kind) {
      case 'text': {
        const pieceList = leafPieces[event.run]!
        for (let k = 0; k < pieceList.length; k++) {
          const p = pieceList[k]!
          if (p.splitBefore) emitSplit(p.start)
          if (current === null || lastFrame < 0 || !continuesAcross(frames[lastFrame]!, p)) {
            flushRun()
            current = { flows: [], tStart: tr.count, tEnd: tr.count, is8bit: true, level: p.level, hasShy: false, hasTab: false, trailingBreak: false, scriptRuns: [], units: [] }
          }
          const b: RunBuild = current
          const tStart = tr.count
          tr.hasShy = false
          tr.hasTab = false
          const leaf = leaves[p.run]!
          inWhitespace = transformFlow(text, p.start, p.end, leaf.is8bit, leaf.style, inWhitespace, leaf.lang, tr)
          b.hasShy ||= tr.hasShy
          b.hasTab ||= tr.hasTab
          b.is8bit &&= leaf.is8bit
          b.tEnd = tr.count
          const fi = frames.length
          // A new mapped flow records the common ancestor with the last frame as the element controlling its initial break
          // (nsTextFrame.cpp:2229-2233); AccumulateRunInfo then makes the frame's parent the common ancestor (:1886-1888).
          b.flows.push({ frame: fi, initialBreakController: commonAncestor })
          frames.push({ run: p.run, start: p.start, end: p.end, level: p.level, textRun: builds.length, tStart, tEnd: tr.count, item: items.length })
          items.push({ kind: 'text', frame: fi, at: p.start })
          lastFrame = fi
          commonAncestor = leaf.parent
        }
        offsetAt = leaves[event.run]!.end
        break
      }
      case 'open': {
        const el = spanAt(elements, event.element)
        el.open = items.length
        items.push({ kind: 'open', element: event.element, at: offsetAt, split: false })
        openStack.push(event.element)
        break
      }
      case 'close': {
        const el = spanAt(elements, event.element)
        el.close = items.length
        el.closes.push(items.length)
        items.push({ kind: 'close', element: event.element, at: offsetAt, split: false })
        openStack.pop()
        // LiftCommonAncestorWithLastFrameToParent with the span's parent after the span is scanned (:2275).
        if (commonAncestor === event.element) commonAncestor = el.parent
        break
      }
      case 'atomic':
      case 'br':
      case 'wbr': {
        const el = objectAt(elements, event.element)
        el.item = items.length
        items.push({ kind: event.kind, element: event.element, at: offsetAt })
        // FlushFrames(true, isBR) before and after the frame (:2246-2272): the first builds the pending run, feeds it to the
        // line breaker and resets it; the second finds no pending run.
        const trailingOn = current !== null && event.kind !== 'br' ? builds.length : -1
        flushRun()
        breakerOps.push({ kind: 'reset', trailingOn }, { kind: 'reset', trailingOn: -1 })
        inWhitespace = false
        // mCommonAncestorWithLastFrame = aFrame, then lifted to its parent (:2256, :2275).
        commonAncestor = el.parent
        break
      }
    }
  }
  // The block's last FlushFrames(true, false) (nsTextFrame.cpp:1730-1735).
  const trailingOn = current !== null ? builds.length : -1
  flushRun()
  breakerOps.push({ kind: 'reset', trailingOn })
  const T = tr.count
  const tUnits = tr.tUnits.slice(0, T)
  const tSource = tr.tSource.slice(0, T)
  const sourceT = tr.sourceT
  const nextT = new Int32Array(n + 1)
  nextT[n] = T
  const lineFeeds: number[] = []
  for (let s = n - 1; s >= 0; s--) {
    nextT[s] = sourceT[s]! >= 0 ? sourceT[s]! : nextT[s + 1]!
    if (text.charCodeAt(s) === 0x0a) lineFeeds.push(s)
  }
  lineFeeds.reverse()

  // 4. Glyph flags per text run.
  const g: Glyphs = { units: tUnits, breakFlags: new Uint8Array(T), clusterStart: new Uint8Array(T).fill(1), isSpace: new Uint8Array(T), kind: new Uint8Array(T) }
  for (let r = 0; r < builds.length; r++) {
    const b = builds[r]!
    b.scriptRuns = textRunScripts(tUnits, b.tStart, b.tEnd, b.is8bit)
    initTextRun(g, b.tStart, b.tEnd, b.is8bit, b.scriptRuns, b.units)
  }
  // The emergency break after a hyphen is set inside one shaped word (SetupClusterBoundaries, gfxFont.cpp:741-753), and
  // InitScriptRun shapes a word per font range (gfxTextRun.cpp:2930-3000): it exists only where the letter before the
  // hyphen, the hyphen and the letter after it are one font's. The coverage facts say which listed family draws each
  // (fonts.ts listedFontOf). One family for all three keeps the flag, two families or a listed one next to the engine's
  // fallback take it away, and where the facts don't say, or all three fall back, the line it decides reports font-fallback.
  for (let r = 0; r < builds.length; r++) {
    const b = builds[r]!
    if (b.flows.length === 0) continue
    const font = leaves[frames[b.flows[0]!.frame]!.run]!.font
    for (let t = b.tStart + 2; t < b.tEnd; t++) {
      if (g.breakFlags[t] !== BREAK_EMERGENCY_WRAP) continue
      const before = listedFontOf(font, tUnits[t - 2]!)
      const hyphen = listedFontOf(font, tUnits[t - 1]!)
      const after = listedFontOf(font, tUnits[t]!)
      if (before === null || hyphen === null || after === null || (before === -1 && hyphen === -1 && after === -1)) gaps.emergencyBreakUnconfirmed(inspected, t)
      else if (before !== hyphen || hyphen !== after) g.breakFlags[t] = BREAK_NONE
    }
  }

  // 5. nsLineBreaker over every flow in document order (SetupBreakSinksForTextRun, nsTextFrame.cpp:2889-2997), with the
  //    resets of frames text can't cross.
  const breaker = new LineBreakerState(env.dictionaryBreaks)
  const styleOfElement = (e: number): GeckoStyle => e < 0 ? blockStyle : spanAt(elements, e).style
  for (let o = 0; o < breakerOps.length; o++) {
    const op = breakerOps[o]!
    if (op.kind === 'reset') {
      const trailing = breaker.reset()
      if (op.trailingOn >= 0 && trailing) builds[op.trailingOn]!.trailingBreak = true
      continue
    }
    const b = builds[op.build]!
    const runState = { noBreaks: true }
    for (let k = 0; k < b.flows.length; k++) {
      const flow = b.flows[k]!
      const f = frames[flow.frame]!
      const leaf = leaves[f.run]!
      const style = leaf.style
      // The CSS word-break and line-break of the flow's start frame (:2913-2940).
      breaker.setWordBreak(style.wordBreak)
      breaker.setStrictness(style.lineBreak)
      let flags = 0
      if (!styleOfElement(flow.initialBreakController).wrap) flags |= BREAK_SUPPRESS_INITIAL // :2956-2963
      if (!style.wrap) flags |= BREAK_SUPPRESS_INSIDE // :2964-2967
      if (runState.noBreaks) flags |= BREAK_SKIP_SETTING_NO_BREAKS
      // HasCompressedLeadingWhitespace (nsTextFrame.cpp:2867-2887).
      for (let s = f.start; s < f.end && sourceT[s] === -1; s++) {
        if (isTrimmableSpaceStyled(text, s, f.end, style)) {
          breaker.appendInvisibleWhitespace(flags)
          break
        }
      }
      if (f.tEnd > f.tStart) {
        const sink: BreakSink = { breakFlags: g.breakFlags, clusterStart: g.clusterStart, isSpace: g.isSpace, textRunStart: b.tStart, flowStart: f.tStart, run: runState }
        breaker.appendText(leaf.lang, tUnits.subarray(f.tStart, f.tEnd), !b.is8bit, flags, sink)
      }
    }
  }

  // 6. Spacing after each character (GetSpacingInternal, nsTextFrame.cpp:4089-4295, letter-spacing model 0).
  const spacingPrefix = new Int32Array(T + 1)
  const scanSpacingPrefix = new Int32Array(T + 1)
  // CalcTabWidths asks GetSpacingInternal for one character at a time (nsTextFrame.cpp:4345-4347), and the base search goes
  // no further back than the range asked for (:4203-4213), so there the base is the character itself: a mark after a cursive
  // letter, script Inherited, takes the letter spacing its cluster doesn't, and so does the low surrogate of a cursive letter
  // (ScalarValueAt gives 0 there, CharacterDataBuffer.h:295-311). Only tab positions read it (lines.ts computeTabs).
  let anyTab = false
  for (let r = 0; r < builds.length; r++) anyTab ||= builds[r]!.hasTab
  const tabSpacingPrefix = anyTab ? new Int32Array(T + 1) : null
  for (let fi = 0; fi < frames.length; fi++) {
    const f = frames[fi]!
    const b = builds[f.textRun]!
    const run = f.run
    const leaf = leaves[run]!
    const style = leaf.style
    for (let t = f.tStart; t < f.tEnd; t++) {
      let spacing = 0
      let scanSpacing = 0
      let tabSpacing = 0
      const ls = leaf.letterSpacingAu
      if (ls !== 0) {
        // CanAddSpacingAfter (nsTextFrame.cpp:3860-3873).
        const canAdd = !(style.newlineIsSignificant && g.kind[t] === KIND_NEWLINE) &&
          (t + 1 >= b.tEnd || (g.clusterStart[t + 1] === 1 && g.kind[t] !== KIND_FORMAT && g.kind[t] !== KIND_TAB))
        if (canAdd) {
          // The cluster's base: FindClusterStart stops at a skipped original character, such as a removed soft hyphen, and
          // at the start of the frame's own characters, which is where the provider's run of kept characters begins
          // (nsTextFrame.cpp:3549-3560, :4203-4213). So a mark after a soft hyphen is its own base, and so is a mark that
          // starts a text node (fresh c-7421ac03d17f9f11: U+0652 starting a span after its seen takes the span's 60 au of
          // letter spacing in 14px Geeza Pro, where the seen's cluster takes none).
          let base = t
          while (base > f.tStart && g.clusterStart[base] === 0 && tSource[base]! - 1 === tSource[base - 1]!) base--
          let cp = tUnits[base]!
          if (base + 1 < b.tEnd && isSurrogatePair(cp, tUnits[base + 1]!)) cp = combine(cp, tUnits[base + 1]!)
          // The frame's width comes from MeasureText, which asks for spacing one glyph run at a time (gfxTextRun.cpp:809-829,
          // :752-765, :372-392), and the base search goes no further back than the range asked for (nsTextFrame.cpp:4203-4213,
          // from run.GetOriginalOffset()). So where another font draws a mark than the character before it, the mark starts a
          // glyph run and is the base found, and a mark of script Inherited isn't cursive: the cluster takes the spacing its
          // cursive letter wouldn't. Probe gecko-port F19 (.artifacts/probes/gecko/round3-f19): under 4px of letter spacing
          // beh with U+0301 stays 576 au in "Courier New" and 685 au in "Times New Roman", which have both, and grows from
          // 934 to 1174 au in "Geeza Pro", which lacks U+0301; Syriac, N'Ko, Mongolian and Hanifi Rohingya letters, all
          // drawn by fallback fonts, grow with U+0301 after them and not with a mark of their own script (U+0730, U+07EB).
          // A mark takes the font of the character before it where that font has it (gfxTextRun.cpp:3181-3212), which the
          // coverage facts answer for the listed families (fonts.ts). Where they don't say, or a fallback font draws the
          // character before the mark, the cluster keeps the cursive rule and reports font-fallback.
          // The break scan asks for spacing over its own buffer of up to 100 characters from the range's start
          // (gfxTextRun.cpp:946-958, :1011-1018), whatever the glyph runs, so it fits lines without this spacing
          // (scanSpacingPrefix).
          let found = cp
          if (isCursiveScript(cp) && t > base + (cp >= 0x10000 ? 1 : 0)) {
            const font = leaf.font
            let previous = listedFontOf(font, cp)
            let unknown = false
            for (let k = base + (cp >= 0x10000 ? 2 : 1); k <= t && !unknown; k++) {
              let mark = tUnits[k]!
              if ((mark & 0xfc00) === 0xdc00) continue
              if (k + 1 <= t && isSurrogatePair(mark, tUnits[k + 1]!)) mark = combine(mark, tUnits[k + 1]!)
              // Join controls, variation selectors and default ignorables take the previous font whatever it maps
              // (gfxTextRun.cpp:3309-3332).
              if (isDefaultIgnorable(mark) || (mark >= 0xfe00 && mark <= 0xfe0f) || mark === 0x200c || mark === 0x200d) continue
              if (previous === null || previous === -1) { unknown = true; break }
              const markFont = extenderFontOf(font, previous, mark)
              if (markFont === null) { unknown = true; break }
              if (markFont !== previous) found = mark
              previous = markFont
            }
            if (unknown) {
              found = cp
              gaps.cursiveClusterFonts(sink, run, cp, tSource[base]!, tSource[t]! + 1)
            }
          }
          if (!isCursiveScript(cp)) scanSpacing += ls
          if (!isCursiveScript(found)) spacing += ls
          if (tabSpacingPrefix !== null) {
            const own = text.charCodeAt(tSource[t]!)
            const scalar = (own & 0xf800) !== 0xd800 ? own : text.codePointAt(tSource[t]!)! > 0xffff ? text.codePointAt(tSource[t]!)! : 0
            if (!isCursiveScript(scalar)) tabSpacing += ls
          }
        }
      }
      const ws = leaf.wordSpacingAu
      if (ws !== 0) {
        // IsCSSWordSpacingSpace on the original character (nsTextFrame.cpp:880-898).
        const s = tSource[t]!
        const ch = text.charCodeAt(s)
        if (((ch === 0x20 || ch === 0xa0) && !isSpaceCombiningSequenceTail(text, s + 1, f.end)) ||
          ((ch === 0x0d || ch === 0x09) && !style.whiteSpaceIsSignificant) || (ch === 0x0a && !style.newlineIsSignificant)) {
          spacing += ws
          scanSpacing += ws
          tabSpacing += ws
        }
      }
      spacingPrefix[t + 1] = spacingPrefix[t]! + spacing
      scanSpacingPrefix[t + 1] = scanSpacingPrefix[t]! + scanSpacing
      if (tabSpacingPrefix !== null) tabSpacingPrefix[t + 1] = tabSpacingPrefix[t]! + tabSpacing
    }
  }

  // 7. Measurement: one context per text run (specs/gecko-canvas.md §2 A1, A6), units measured whole (A4, E1, E2).
  const unitOf = new Int32Array(T)
  const units: GeckoUnit[] = []
  const correction = new Int32Array(T)
  const textRuns: GeckoTextRun[] = []
  // One record per distinct context of the text runs, which the runs that measure alike share (types.ts RunContexts).
  const runContexts = new Map<Context, RunContexts>()
  for (let r = 0; r < builds.length; r++) {
    const b = builds[r]!
    const firstRun = frames[b.flows[0]!.frame]!.run
    const firstLeaf = leaves[firstRun]!
    const font = firstLeaf.font
    const lang = firstLeaf.lang
    // The source range of the text run's characters: the text whose widths a condition of the run concerns (DESIGN.md §2.8).
    const at = b.tEnd > b.tStart ? { start: tSource[b.tStart]!, end: tSource[b.tEnd - 1]! + 1 } : { start: frames[b.flows[0]!.frame]!.start, end: frames[b.flows[0]!.frame]!.start }
    const domAu = lroundf(f32(quantize10(font.size) * 60))
    // The DOM shapes at the device font size, the nsFont size in au over the page's apd (nsFontMetrics.cpp:124-134), and
    // rounds every glyph to the page's app units (gfxHarfBuzzShaper.cpp:1559, :1699-1702). An OffscreenCanvas shapes at
    // the CSS size with a font group of its own and rounds at 60 app units per px (CanvasRenderingContext2D.cpp:4423-4492,
    // :7135-7140). The port measures there always (the maintainer's decision of 2026-09-18: one measuring path, no
    // `document`). What that leaves unpredicted, by probe: a glyph whose unrounded advance sits within the two scales'
    // rounding of a half app unit comes out 1 au apart (probe gecko-port F7, F13: `modern` in 15px "Helvetica Neue" is 3118
    // au in the DOM and 3119 in Canvas, where `n` after the kern split is 508.4999 au at the DOM's scale and 508.5004 at
    // Canvas's), and synthetic bold, whose offset isn't linear in the device size (gfxFont.h:1899-1904; probe F14: `⃣❤` in
    // bold 14px "Helvetica Neue" is 786 au in the DOM and 793 in Canvas). The first shows in no OffscreenCanvas measurement.
    // The second does, as weight 700 less weight 400 (probe F24), which the port reads for bitmap emoji only (below); for
    // text glyphs it stays unpredicted by the same decision. Neither has a gap: they are the residual classes
    // `gecko/one-shaping-unit-one-app-unit` and `gecko/synthetic-bold-offset` (specs/gecko-RESULTS.md "Ceiling round 4"). A
    // detached `<canvas>` element at the device size reproduces both (F13, F14) and was round 3's measuring path; it needs
    // `document` and shares the DOM's font groups.
    const devSize = domAu / apd
    // The size Canvas takes to the font cache, in au: 7 bits of the CSS size (:4207-4217).
    const canvasAuSize = quantize7(font.size) * 60
    gaps.canvasFontSize(sink, firstRun, domAu, canvasAuSize, at)
    gaps.opticalSize(sink, firstRun, font, at, fontDeclarations)
    // An explicit ctx.lang: OffscreenCanvas would otherwise take the root element's lang (CanvasRenderingContext2D.cpp:5446-5465).
    // Content with lang="" matches fonts under the locale language (nsFontCache.cpp:61-63).
    const canvasLang = lang === '' && env.regionalPrefsLocale !== null ? env.regionalPrefsLocale : lang
    const settings = {
      font: canvasFont(font, font.size), lang: canvasLang, letterSpacing: firstLeaf.letterSpacingAu !== 0 ? '0.001px' : '0px',
      wordSpacing: '0px', fontKerning: 'auto' as const, textRendering: 'auto' as const,
      direction: (b.level & 1) === 1 ? 'rtl' as const : 'ltr' as const, partition: '',
    }
    const shared = runContextsFor(runContexts, contexts, settings)
    const context = shared.own
    const auIn = (ctx: Context, s: string) => Math.round(width(ctx, s) * CANVAS_AU_PER_PX)
    const au = (s: string) => auIn(context, s)
    let advance = 0
    const run = { contexts: shared, scriptRuns: b.scriptRuns, tStart: b.tStart }
    // The width of U+0020 in the run's context, which every boundary space of the run takes: asked at the first one. A
    // boundary U+00A0 is a shaped word of its own, the character U+00A0 (gfxFont.cpp:3834-3861), so it takes the font's
    // glyph for U+00A0, and the space glyph only where the font has none (gfxHarfBuzzShaper.cpp:113-118; font matching tries
    // U+0020 for it, gfxTextRun.cpp:3226-3229). Canvas shapes it the same way, so it is asked as itself, at the run's first
    // one. Probe gecko-mainfacts M4: in 43 of 249 styles the two differ (16px "Hoefler Text" 754 au against 240, Charter 534
    // against 267, Thonburi 640 against 319), and W(U+00A0) is the DOM's advance in 228 of the 249, where W(U+0020) is in
    // 197; of the other 21, 18 are off for the space by the same amount (synthetic bold, system-ui) and 3 are "Apple Color
    // Emoji" as the first family, where the DOM takes the glyph's device-size advance.
    let spaceAu: number | null = null
    let nbspAu: number | null = null
    // Whether a space takes part in shaping shows in the units measured together, which only a gap reads (gaps.ts).
    const spaces = gaps.spaceTest(sink, context, firstRun, tUnits, tSource, b.tStart)
    for (let u = 0; u < b.units.length; u++) {
      const { kind, tStart: t, tEnd: e } = b.units[u]!
      let unit: GeckoUnit
      switch (kind) {
        case 'space':
        case 'nbsp': {
          let w = kind === 'space' ? spaceAu ??= au(' ') : nbspAu ??= au('\u00a0')
          // A character after U+200D takes the font of the character before it where that font has it (FindFontForChar,
          // gfxTextRun.cpp:3319-3325), and a boundary space is the space glyph of its own font run (gfxTextRun.cpp:1590-1622).
          // So after a word that ends in U+200D the space is the word's last font's: the word with the space after it, less
          // the word (fresh c-9d8986212ef18179: after Hebrew and U+200D in 18px Georgia the space is 270 au, the fallback
          // font's, where Georgia's is 261 au).
          const last = units.length > 0 ? units[units.length - 1]! : null
          if (last !== null && last.kind === 'word' && last.tEnd === t && tUnits[t - 1] === 0x200d) {
            w = rangeAu(context, run, tUnits, last.tStart, t + 1) - last.canvasAu
          }
          unit = { kind, tStart: t, tEnd: e, canvasAu: w, au: w, startAdvance: advance, inWord: null }
          gaps.spaceMeasured(spaces, w)
          break
        }
        case 'invalid':
          gaps.invalidMet(spaces, t)
          unit = { kind, tStart: t, tEnd: e, canvasAu: 0, au: 0, startAdvance: advance, inWord: null }
          break
        case 'word': {
          const w = rangeAu(context, run, tUnits, t, e)
          gaps.letterSpacedGroups(sink, contexts, run, firstRun, firstLeaf.letterSpacingAu, tUnits, tSource, g.clusterStart, spacingPrefix, t, e, w)
          let total = w
          if (!b.is8bit) {
            // Apple Color Emoji is an sbix font: the DOM takes its advances from Core Text at the device size, Canvas at the
            // CSS size (gfxMacFont.cpp:437-463; specs/gecko-canvas.md §1.9, §2 A12). Which font draws a cluster is font
            // matching's decision (gfxFontGroup::FindFontForChar, gfxTextRun.cpp:3178-3600), and the document's fallback
            // history changes it: after one U+1F600 U+FE0E, Canvas and the DOM both draw U+1F600 with a text font (probes
            // gecko-port F2, F3). Canvas shows which: Apple Color Emoji draws the cluster when it measures the same in the
            // run's font list as in "Apple Color Emoji" alone, at the CSS size and at the device size (F3, 16px Arial:
            // fresh 1260 and 1920 au in both; pinned 1020 au in Arial and 1260 au in Apple Color Emoji, DOM 1020 au).
            const deviceContext = contextFor(contexts, { ...settings, font: canvasFont(font, devSize) })
            const emojiFontContext = (size: number) => contextFor(contexts, { ...settings, font: canvasFont({ ...font, family: COLOR_EMOJI_FAMILY }, size) })
            let word = ''
            for (let k = t; k < e; k++) word += String.fromCharCode(tUnits[k]!)
            const boundaries = graphemeBoundaries(word, geckoGraphemeRules)
            for (let c = 0; c + 1 < boundaries.length; c++) {
              const cluster = word.slice(boundaries[c]!, boundaries[c + 1]!)
              const first = cluster.codePointAt(0)!
              const spaceDivisor = cluster.length === 1 ? synthesizedSpaceDivisor(first) : 0
              if (spaceDivisor > 0) {
                // A Unicode space no font in the list covers gets no fallback font: InitScriptRun gives it the space glyph at
                // apd × floor(adjusted size / divisor + 0.5), whole device pixels (gfxTextRun.cpp:3032-3043, :3572-3577;
                // gfxFont.cpp:4792-4826). Canvas rounds at apd 60 from its 7-bit size, so 18px U+2009 is 240 au in Canvas and
                // 210 au in the DOM at apd 30. Canvas shows a synthesized space: it measures that value at the CSS size and at
                // the device size, where a font's own glyph scales with the size.
                const synthesized = (size: number) => 60 * Math.floor(quantize7(size) / spaceDivisor + 0.5)
                const atCssSize = au(cluster)
                if (atCssSize === synthesized(font.size) && auIn(deviceContext, cluster) === synthesized(devSize)) {
                  const delta = apd * Math.floor(devSize / spaceDivisor + 0.5) - atCssSize
                  correction[t + boundaries[c]!] = delta
                  total += delta
                }
                continue
              }
              // A character without the Emoji property gets text presentation in fallback, which looks for a font without
              // color glyphs (gfxTextRun.cpp:3541-3546); a cluster extender takes the previous character's font (:3181-3194).
              const presentation = emojiPresentation(first)
              if (presentation === 'text-only') continue
              // One measureText gives the cluster's width and its ink box, in the run's font list and in "Apple Color Emoji" alone.
              const own = bounds(context, cluster)
              const inEmoji = bounds(emojiFontContext(font.size), cluster)
              const atCssSize = Math.round(own.width * CANVAS_AU_PER_PX)
              // The cluster's Canvas au at the device size where Apple Color Emoji draws it, null where another font does.
              // The ink box too: a text font whose widths happen to equal Apple Color Emoji's at both sizes still draws another
              // glyph. Probe gecko-port F11 (.artifacts/probes/gecko/round2b): U+1F600 in Arial, Menlo, "Apple Symbols" and
              // "Times New Roman" measures as in "Apple Color Emoji" alone, box [60, 1020] au, and U+263A in Arial doesn't (980 au,
              // box [−131.25, 848.91]).
              let deviceAu60: number | null = null
              if (atCssSize === Math.round(inEmoji.width * CANVAS_AU_PER_PX)) {
                const atDeviceSize = auIn(deviceContext, cluster)
                if (atDeviceSize === auIn(emojiFontContext(devSize), cluster) && own.left === inEmoji.left && own.right === inEmoji.right) deviceAu60 = atDeviceSize
              }
              const clusterAt = { start: tSource[t + boundaries[c]!]!, end: tSource[t + boundaries[c + 1]! - 1]! + 1 }
              const next = cluster.codePointAt(first >= 0x10000 ? 2 : 1) ?? 0
              gaps.textPresentationSearch(sink, firstRun, font, first, presentation, next, clusterAt)
              if (deviceAu60 === null) {
                gaps.pinnedEmojiFont(sink, firstRun, first, presentation, next, atCssSize, clusterAt)
                continue
              }
              gaps.emojiFontOwnList(sink, firstRun, font, settings.font, first, presentation, next, clusterAt)
              gaps.deviceSizeOffGrid(sink, firstRun, apd, devSize, clusterAt)
              // The DOM stores floor(apd × device advance + 0.5) (gfxHarfBuzzShaper.cpp:1559); a lone regional indicator's
              // advance isn't a whole pixel (28.683px at 28px), so round once from the Canvas au at the device size.
              let dom = Math.floor(deviceAu60 * apd / 60 + 0.5)
              if ((deviceAu60 * apd) % 60 !== 0) {
                // Canvas's au at the device size rounds once at apd 60, and the DOM rounds at the page's apd. Under a bold font
                // the advance holds synthetic bold's step: Apple Color Emoji has no bold face, and PostShapingFixup adds
                // NS_round(offset × apd) to each character that holds glyphs, after the glyphs were rounded, with offset =
                // 0.25 + 0.75 × size / 48 device px below 48px and size / 48 from there (gfxFont.cpp:3551-3562, :901-939;
                // gfxFont.h:1899-1904). Canvas shows it: the cluster at the run's weight less the cluster at weight 400, both
                // at the device size, is a whole number of Canvas's own steps, NS_round(offset × 60). The DOM's advance is then
                // the weight 400 advance at the page's apd plus as many of the DOM's steps. Probe gecko-port F24: U+1F600 in
                // bold 20px Arial is 1226 au natively, 2400 au × 30 / 60 and NS_round(0.875 × 30) = 26, where the bold
                // Canvas advance of 2453 au gives 1227.
                const regularAu60 = auIn(contextFor(contexts, { ...settings, font: canvasFont({ ...font, weight: 400 }, devSize) }), cluster)
                const canvasStep = Math.floor(syntheticBoldOffset(quantize7(devSize)) * 60 + 0.5)
                const steps = (deviceAu60 - regularAu60) / canvasStep
                if (font.weight !== 400 && Number.isInteger(steps) && steps >= 1 && (regularAu60 * apd) % 60 === 0) {
                  dom = regularAu60 * apd / 60 + steps * Math.floor(syntheticBoldOffset(devSize) * apd + 0.5)
                } else {
                  gaps.inexactDeviceAdvance(sink, firstRun, deviceAu60, apd, clusterAt)
                }
              }
              const delta = dom - atCssSize
              correction[t + boundaries[c]!] = delta
              total += delta
            }
          }
          unit = { kind: 'word', tStart: t, tEnd: e, canvasAu: w, au: total, startAdvance: advance, inWord: null }
          gaps.wideUnit(sink, firstRun, w, tSource[t]!, tSource[e - 1]! + 1)
          gaps.wordMeasured(spaces, t, w)
          break
        }
      }
      for (let k = t; k < e; k++) unitOf[k] = units.length
      units.push(unit)
      advance += unit.au
    }
    gaps.runEnded(spaces, b.tEnd)
    textRuns.push({
      tStart: b.tStart, tEnd: b.tEnd, level: b.level, contexts: shared, font, scriptRuns: run.scriptRuns, hasShy: b.hasShy,
      trailingBreak: b.trailingBreak, minTabAdvance: b.hasTab ? 0.5 * au('0') : 0,
      hyphenAu: b.hasShy ? au('‐') : 0, hasTab: b.hasTab, totalAdvance: advance,
      advancesStandIn: canvasAuSize !== domAu ? 'font-size-quantization' : font.facts.opticalSizeAxis !== false ? 'optical-size' : null,
    })
  }
  const correctionPrefix = new Int32Array(T + 1)
  const tabPositions: number[] = []
  const continuationPairs: number[] = []
  for (let t = 0; t < T; t++) {
    correctionPrefix[t + 1] = correctionPrefix[t]! + correction[t]!
    if (g.kind[t] === KIND_TAB) tabPositions.push(t)
    if (g.clusterStart[t] === 0) {
      if (t === 0 || g.clusterStart[t - 1] !== 0) continuationPairs.push(t)
    } else if (t > 0 && g.clusterStart[t - 1] === 0) continuationPairs.push(t)
  }
  if (T > 0 && g.clusterStart[T - 1] === 0) continuationPairs.push(T)
  const clusterContinuations = new Int32Array(continuationPairs)

  // ComputeTabWidthAppUnits (nsTextFrame.cpp:3875-3906) reads the space, the letter spacing and the word spacing from the
  // containing block, and tab-size from the text frame (lines.ts computeTabs).
  let tabs: GeckoPrepared['tabs'] = null
  if (tabSpacingPrefix !== null) {
    const context = contextFor(contexts, {
      font: canvasFont(paragraph.font, paragraph.font.size), lang: paragraph.lang,
      letterSpacing: pxToAu(paragraph.letterSpacing) !== 0 ? '0.001px' : '0px', wordSpacing: '0px', fontKerning: 'auto',
      textRendering: 'auto', direction: 'ltr', partition: '',
    })
    const space = Math.round(width(context, ' ') * CANVAS_AU_PER_PX)
    tabs = { unit: space + pxToAu(paragraph.letterSpacing) + pxToAu(paragraph.wordSpacing), spacingPrefix: tabSpacingPrefix, positions: tabPositions }
  }

  // What the text itself can't tell Canvas: dictionary breaks, U+FFFD and the figure spaces (gaps.ts).
  gaps.dictionaryBreaks(sink, env, text)
  gaps.replacementCharacters(sink, text, leaves)
  gaps.figureSpaces(sink, apd, text, leaves)

  return {
    paragraph, env, appUnitsPerDevPixel: apd, blockStyle, text, lineFeeds, leaves, frames, items,
    elements, textRuns, tUnits, tSource, breakFlags: g.breakFlags, clusterStart: g.clusterStart, clusterContinuations, isSpace: g.isSpace, kind: g.kind,
    spacingPrefix, scanSpacingPrefix, correctionPrefix, unitOf, units, sourceT, nextT, tabs, textIndentAu: pxToAu(paragraph.textIndent), bidi: resolveBidi, contexts, inspect: inspected,
  }
}

