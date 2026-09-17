// Content building for Gecko (Firefox 156.0): frames, bidi splits, text runs, TransformText per mapped flow, glyph
// flags, nsLineBreaker breaks, spacing and the app-unit advances known before lines are filled.
// specs/gecko-text.md §2-§12, specs/gecko-canvas.md §2-§3, specs/probes-firefox.md.
import type { GeckoEnvironment } from '../../env.js'
import { measureContext, measureText, type Measurer } from '../../measure/canvas.js'
import { canvasFont } from '../../measure/font.js'
import type { Gap, Paragraph } from '../../model.js'
import { opticalSizeAxisOf, quantize10, sameFontForTextRun } from './fonts.js'
import { canonicalLanguageTag } from './likely.js'
import { bidiDataFor } from '../../unicode/bidi.js'
import { graphemeBoundaries, graphemeRulesFor } from '../../unicode/grapheme.js'
import { resolveUnicodeBidi } from '../../unicode/unicode-bidi.js'
import {
  BREAK_EMERGENCY_WRAP, BREAK_NONE, BREAK_NORMAL, BREAK_SKIP_SETTING_NO_BREAKS, BREAK_SUPPRESS_INITIAL, BREAK_SUPPRESS_INSIDE,
  LineBreakerState, complexLanguage, type BreakSink,
} from './linebreak.js'
import {
  hasScript, isAlphanumeric, isBidiControl, isBidiMirrored, isClosePunctuation, isClusterExtender,
  isClusterExtenderExcludingJoiners, isCursiveScript, isDefaultIgnorable, isEastAsianPunctuation, isEmoji,
  isEmojiPresentation, isFormatCategory, isOpenPunctuation, isSegmentBreakSkipChar, isUtf16CodeUnitBidi, openingMirror,
  scriptOf,
} from './props.js'
import {
  KIND_FORMAT, KIND_GLYPH, KIND_INVISIBLE, KIND_NEWLINE, KIND_TAB, type GeckoFrame, type GeckoPrepared, type GeckoStyle,
  type GeckoTextRun, type GeckoUnit, type ScriptRun,
} from './types.js'

const f32 = Math.fround
const SHY = 0x00ad

// NS_lroundf (nsMathUtils.h:31-33) on a float32 value.
export function lroundf(x: number): number {
  return x >= 0 ? Math.trunc(f32(x + 0.5)) : Math.trunc(f32(x - 0.5))
}

// StyleCSSPixelLength::ToAppUnits: NSToIntRound(float(px) × 60f) (ServoStyleConstsInlines.h:584-595).
export const pxToAu = (px: number): number => lroundf(f32(f32(px) * 60))

// CanvasRenderingContext2D QuantizeFontSize, 7 significant bits (CanvasRenderingContext2D.cpp:4207-4217).
function quantize7(size: number): number {
  const d = f32(size * 131073)
  const t = f32(d - size)
  return f32(d - t)
}

export function geckoStyle(p: Paragraph): GeckoStyle {
  let collapse: GeckoStyle['collapse']
  let wrap: boolean
  switch (p.whiteSpace) {
    case 'normal': collapse = 'collapse'; wrap = true; break
    case 'nowrap': collapse = 'collapse'; wrap = false; break
    case 'pre': collapse = 'preserve'; wrap = false; break
    case 'pre-wrap': collapse = 'preserve'; wrap = true; break
    case 'pre-line': collapse = 'preserve-breaks'; wrap = true; break
    case 'break-spaces': collapse = 'break-spaces'; wrap = true; break
  }
  const overflowWrap = p.wordBreak === 'break-word' ? 'anywhere' : p.overflowWrap // nsStyleStruct.h:1303-1315
  let wordBreak: GeckoStyle['wordBreak']
  switch (p.wordBreak) {
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
  }
}

const isSurrogatePair = (a: number, b: number) => (a & 0xfc00) === 0xd800 && (b & 0xfc00) === 0xdc00
const combine = (a: number, b: number) => 0x10000 + ((a - 0xd800) << 10) + (b - 0xdc00)

// nsContentUtils::IsHyphen (nsContentUtils.cpp:2257-2265).
const isHyphen = (u: number) => u === 0x2d || u === 0x2010 || u === 0x2012 || u === 0x2013 || u === 0x058a

// gfxFontGroup::IsInvalidChar (gfxTextRun.h:971-992).
function isInvalidChar16(ch: number): boolean {
  if (ch >= 0x20 && ch < 0x7f) return false
  if (ch <= 0x9f) return true
  return ((ch & 0xff00) === 0x2000 && (ch === 0x200b || ch === 0x2028 || ch === 0x2029 || ch === 0x2060)) ||
    ch === 0xfeff || isBidiControl(ch)
}
const isInvalidChar8 = (ch: number) => (ch & 0x7f) < 0x20 || ch === 0x7f

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
const graphemeRules = graphemeRulesFor('gecko')

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
  const boundaries = graphemeBoundaries(word, graphemeRules)
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

function splitAndInitTextRun(g: Glyphs, runStart: number, runLen: number, run8bit: boolean): void {
  if (runLen === 0) return
  let wordStart = 0
  let wordIs8bit = true
  let nextCh = g.units[runStart]!
  for (let i = 0; i <= runLen; i++) {
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
    if (boundary) { // SetSpaceGlyphIfSimple (gfxTextRun.cpp:1612-1619), NBSP shaped as its own word
      g.breakFlags[runStart + i] = BREAK_NONE
      g.clusterStart[runStart + i] = 1
      g.isSpace[runStart + i] = ch === 0x20 ? 1 : 0
      g.kind[runStart + i] = KIND_GLYPH
      wordStart = i + 1
      wordIs8bit = true
      continue
    }
    if (i === runLen) break
    zeroGlyphs(g, runStart + i, runStart + i + 1) // gfxFont.cpp:3872-3897
    g.kind[runStart + i] = ch === 0x09 ? KIND_TAB : ch === 0x0a ? KIND_NEWLINE : isFormatCategory(ch) ? KIND_FORMAT : KIND_INVISIBLE
    wordStart = i + 1
    wordIs8bit = true
  }
}

// gfxScriptItemizer (gfxScriptItemizer.cpp:60-243), run boundaries only.
const PAREN_STACK_DEPTH = 32
function scriptRunLimits(units: Uint16Array, start: number, end: number): ScriptRun[] {
  const limits: ScriptRun[] = []
  const parenChar = new Int32Array(PAREN_STACK_DEPTH)
  const parenScript: string[] = new Array<string>(PAREN_STACK_DEPTH).fill('Zyyy')
  let parenSp = -1
  let pushCount = 0
  let fixupCount = 0
  let scriptLimit = start
  const canMerge = (s: string) => s === 'Zyyy' || s === 'Zinh' || s === 'Zzzz'
  while (scriptLimit < end) {
    fixupCount = 0
    let scriptCode = 'Zyyy'
    while (scriptLimit < end) {
      const startOfChar = scriptLimit
      let ch = units[scriptLimit]!
      let sc: string
      if (ch < 0x02ea) { // gfxScriptItemizer.h:96-107
        const latin = ((ch & ~0x20) >= 0x41 && (ch & ~0x20) <= 0x5a) || (ch >= 0xc0 && ch <= 0xd6) ||
          (ch >= 0xd8 && ch <= 0xf6) || (ch >= 0xf8 && ch <= 0x2b8) || (ch & ~0x10) === 0xaa || (ch >= 0x2e0 && ch <= 0x2e4)
        sc = latin ? 'Latn' : 'Zyyy'
      } else {
        if (scriptLimit < end - 1 && isSurrogatePair(ch, units[scriptLimit + 1]!)) {
          scriptLimit++
          ch = combine(units[startOfChar]!, units[scriptLimit]!)
        }
        sc = scriptOf(ch)
      }
      let pair = 0
      if (sc === 'Zyyy') {
        if (ch < 0x0f3a) {
          if (ch === 0x28 || ch === 0x5b || ch === 0x7b) pair = 1
          else if (ch === 0x29 || ch === 0x5d || ch === 0x7d) pair = 2
        } else if (isOpenPunctuation(ch)) {
          pair = 1
        } else if (isClosePunctuation(ch)) {
          pair = 2
        }
        if (pair === 1) {
          const endPairChar = ch < 0x0f3a ? (ch === 0x28 ? 0x29 : ch === 0x5b ? 0x5d : 0x7d) : openingMirror(ch)
          if (endPairChar !== ch) {
            pushCount = pushCount < PAREN_STACK_DEPTH ? pushCount + 1 : PAREN_STACK_DEPTH
            fixupCount = fixupCount < PAREN_STACK_DEPTH ? fixupCount + 1 : PAREN_STACK_DEPTH
            parenSp = (parenSp + 1) % PAREN_STACK_DEPTH
            parenChar[parenSp] = endPairChar
            parenScript[parenSp] = scriptCode
          }
        } else if (pair === 2 && isBidiMirrored(ch)) {
          while (pushCount > 0 && parenChar[parenSp] !== ch) {
            if (fixupCount > 0) fixupCount--
            pushCount--
            parenSp = (parenSp + PAREN_STACK_DEPTH - 1) % PAREN_STACK_DEPTH
            if (pushCount === 0) parenSp = -1
          }
          if (pushCount > 0) sc = parenScript[parenSp]!
        }
      }
      if (sc === 'Hira') sc = 'Kana'
      const same = canMerge(scriptCode) || canMerge(sc) || sc === scriptCode || isClusterExtender(ch) || hasScript(ch, scriptCode)
      if (same) {
        if (scriptCode === 'Zyyy' && !canMerge(sc)) {
          scriptCode = sc
          let fixupSp = (parenSp + PAREN_STACK_DEPTH - fixupCount) % PAREN_STACK_DEPTH
          for (; fixupCount > 0; fixupCount--) {
            fixupSp = (fixupSp + 1) % PAREN_STACK_DEPTH
            parenScript[fixupSp] = sc
          }
          fixupCount = 0xffffffff // `while (fixupCount-- > 0)` on a uint32_t (gfxScriptItemizer.h:134-135)
        }
        if (pair === 2 && isBidiMirrored(ch) && pushCount > 0) {
          if (fixupCount > 0) fixupCount--
          pushCount--
          parenSp = (parenSp + PAREN_STACK_DEPTH - 1) % PAREN_STACK_DEPTH
          if (pushCount === 0) parenSp = -1
        }
      } else {
        scriptLimit = startOfChar
        break
      }
      scriptLimit++
    }
    limits.push({ limit: scriptLimit, script: scriptCode })
  }
  return limits
}

const isCommonScript = (s: string) => s === 'Zyyy' || s === 'Zinh' || s === 'Zzzz'
const fastLatin = (ch: number) => ((ch & ~0x20) >= 0x41 && (ch & ~0x20) <= 0x5a) || (ch >= 0xc0 && ch <= 0xd6) ||
  (ch >= 0xd8 && ch <= 0xf6) || (ch >= 0xf8 && ch <= 0x2b8) || (ch & ~0x10) === 0xaa || (ch >= 0x2e0 && ch <= 0x2e4)

// The script runs gfxFontGroup::InitTextRun shapes [start, end) with (gfxTextRun.cpp:2700-2800): text with every code
// unit below U+02EA is one run, Latin when it has a Latin letter (8-bit: A-Z only), else Common resolved from the
// language; other text goes through the itemizer. Common stays Common here, standing for "resolved from the language".
function textRunScripts(units: Uint16Array, start: number, end: number, is8bit: boolean): ScriptRun[] {
  let allCommonOrLatin = true
  for (let i = start; i < end; i++) if (units[i]! >= 0x02ea) { allCommonOrLatin = false; break }
  if (!allCommonOrLatin) return scriptRunLimits(units, start, end)
  let hasLetter = false
  for (let i = start; i < end && !hasLetter; i++) {
    const u = units[i]!
    hasLetter = is8bit ? ((u & ~0x20) >= 0x41 && (u & ~0x20) <= 0x5a) : fastLatin(u)
  }
  return [{ limit: end, script: hasLetter ? 'Latn' : 'Zyyy' }]
}

function scriptAt(units: Uint16Array, i: number): string {
  const u = units[i]!
  if (u < 0x02ea) return fastLatin(u) ? 'Latn' : 'Zyyy'
  return scriptOf(isSurrogatePair(u, units[i + 1] ?? 0) ? combine(u, units[i + 1]!) : u)
}

// The script context a piece [tStart, tEnd) of a word unit needs: the DOM itemizer merges Common characters into the
// script run around them (gfxScriptItemizer.cpp:60-243), and HarfBuzz shapes with that run's script (CJK runs without
// kern, gfxHarfBuzzShaper.cpp:1405-1438). When the piece measured alone itemizes to another script, a character of the
// DOM's script from the same script run, before or after the piece, gives Canvas that script.
function scriptContextFor(units: Uint16Array, runs: ScriptRun[], runStart: number, tStart: number, tEnd: number):
  { text: string; before: boolean } | null {
  let from = runStart
  let k = 0
  while (runs[k]!.limit <= tStart) { from = runs[k]!.limit; k++ }
  const domScript = runs[k]!.script
  if (isCommonScript(domScript)) return null
  // Canvas builds its text run from a 16-bit string (CanvasRenderingContext2D.cpp:4822-4851).
  const alone = textRunScripts(units.subarray(tStart, tEnd), 0, tEnd - tStart, false)[0]!.script
  if (alone === domScript) return null
  const limit = runs[k]!.limit
  for (let i = tStart - 1; i >= from; i--) {
    if (scriptAt(units, i) !== domScript) continue
    const u = units[i]!
    if ((u & 0xfc00) === 0xdc00 && i > from) return { text: String.fromCharCode(units[i - 1]!, u), before: true }
    return { text: String.fromCharCode(u), before: true }
  }
  for (let i = tEnd; i < limit; i++) {
    if (scriptAt(units, i) !== domScript) continue
    const u = units[i]!
    if (isSurrogatePair(u, units[i + 1] ?? 0)) return { text: String.fromCharCode(u, units[i + 1]!), before: false }
    return { text: String.fromCharCode(u), before: false }
  }
  return null
}

// The Canvas au of transformed text [tStart, tEnd) of one shaping unit, shaped in the script the paragraph gives it:
// `context + ' ' + piece` less `context + ' '` (or the mirror) where scriptContextFor names a context. U+0020 is a shaping
// word boundary that nothing kerns across (gfxFont.cpp:3781-3866), and in the Canvas text run the space and the piece's
// Common characters join the context's script run. Units, suffixes and prefixes all go through this one recipe.
export function rangeAu(m: Measurer, run: Pick<GeckoTextRun, 'context' | 'scriptRuns' | 'tStart'>, units: Uint16Array,
  tStart: number, tEnd: number): number {
  let piece = ''
  for (let k = tStart; k < tEnd; k++) piece += String.fromCharCode(units[k]!)
  const w = (s: string) => Math.round(measureText(m, run.context, s) * 60)
  const context = scriptContextFor(units, run.scriptRuns, run.tStart, tStart, tEnd)
  if (context === null) return w(piece)
  return context.before ? w(context.text + ' ' + piece) - w(context.text + ' ') : w(piece + ' ' + context.text) - w(' ' + context.text)
}

function initTextRun(g: Glyphs, start: number, end: number, is8bit: boolean): void {
  if (end === start) return
  if (is8bit) {
    splitAndInitTextRun(g, start, end - start, true)
    return
  }
  let allCommonOrLatin = true
  for (let i = start; i < end; i++) if (g.units[i]! >= 0x02ea) { allCommonOrLatin = false; break }
  if (allCommonOrLatin) {
    splitAndInitTextRun(g, start, end - start, false)
  } else {
    const limits = scriptRunLimits(g.units, start, end)
    let runStart = start
    for (let k = 0; k < limits.length; k++) {
      splitAndInitTextRun(g, runStart, limits[k]!.limit - runStart, false)
      runStart = limits[k]!.limit
    }
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

// The color emoji font Core Text draws emoji with on macOS 27, a recorded browser fact of the pinned build (probe
// gecko-port F3, rebuild/probes/gecko-emoji-font.ts; data/gecko/apple-color-emoji-advances-macos27.tsv). Its advances come
// from Core Text at the device size (gfxMacFont.cpp:437-463).
const COLOR_EMOJI_FAMILY = '"Apple Color Emoji"'

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

// nsUnicodeProperties.h:127-165 GetEmojiPresentation.
type EmojiPresentation = 'text-only' | 'text-default' | 'emoji-default'
function emojiPresentation(cp: number): EmojiPresentation {
  if (cp === 0x23 || cp === 0x2a || (cp >= 0x30 && cp <= 0x39) || cp === 0xa9 || cp === 0xae) return 'text-default'
  if (cp < 0x2000 || !isEmoji(cp)) return 'text-only'
  return isEmojiPresentation(cp) ? 'emoji-default' : 'text-default'
}

// gfxFontGroup::FindFontForChar asks for a color glyph when the next character is VS16 or a skin tone modifier, for a
// black flag with tag letters, or for an emoji-default character not followed by VS15 (gfxTextRun.cpp:3268-3308,
// font-variant-emoji normal).
function prefersColorGlyph(presentation: EmojiPresentation, ch: number, next: number): boolean {
  if (next === 0xfe0f || (next >= 0x1f3fb && next <= 0x1f3ff) || (ch === 0x1f3f4 && next >= 0xe0061 && next <= 0xe007a)) return true
  return presentation === 'emoji-default' && next !== 0xfe0e
}

export function prepareGecko(paragraph: Paragraph, env: GeckoEnvironment, measurer: Measurer): GeckoPrepared {
  const style = geckoStyle(paragraph)
  const apd = Math.max(1, Math.floor(60 / env.devicePixelRatio + 0.5)) // nsDeviceContext.cpp:52-63
  const runs = paragraph.runs
  const runStarts: number[] = []
  let text = ''
  for (let i = 0; i < runs.length; i++) {
    runStarts.push(text.length)
    text += runs[i]!.text
  }
  runStarts.push(text.length)
  const n = text.length
  const gaps: Gap[] = []
  const letterSpacingAu: number[] = []
  const wordSpacingAu: number[] = []
  const langs: string[] = []
  const runIs8bit: boolean[] = []
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]!
    letterSpacingAu.push(pxToAu(r.letterSpacing))
    wordSpacingAu.push(pxToAu(r.wordSpacing))
    langs.push(canonicalLanguageTag(r.lang ?? paragraph.lang))
    let is8bit = true
    for (let k = 0; k < r.text.length; k++) if (r.text.charCodeAt(k) >= 0x100) { is8bit = false; break }
    runIs8bit.push(is8bit)
    if (langs[i] === '') gaps.push({ gap: 'ui-language', run: i, detail: 'lang="": font lists and generic families follow the OS locale, which pages cannot read' })
  }

  // 1. Frames (nsCSSFrameConstructor.cpp:5220-5290): a bare white-space-only 8-bit text node that is the block's first or
  //    last child gets no frame under white-space normal or nowrap. A span's own child list has no line boundary.
  type Piece = { run: number; start: number; end: number; level: number }
  let pieces: Piece[] = []
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]!
    if (r.text.length === 0) continue
    if (r.node === 'text' && (i === 0 || i === runs.length - 1) && style.collapse === 'collapse' && runIs8bit[i]) {
      let onlyWhitespace = true
      for (let k = 0; k < r.text.length; k++) {
        const u = r.text.charCodeAt(k)
        if (u !== 0x20 && u !== 0x09 && u !== 0x0a && u !== 0x0d && u !== 0x0c) { onlyWhitespace = false; break }
      }
      if (onlyWhitespace) continue
    }
    pieces.push({ run: i, start: runStarts[i]!, end: runStarts[i + 1]!, level: 0 })
  }

  // 2. Bidi (nsBidiPresUtils.cpp:790-1167): resolve when the block is RTL or a 16-bit node has RTL characters; each
  //    preserved line is its own paragraph, and frames split where the level run ends.
  let resolveBidi = paragraph.direction === 'rtl'
  for (let k = 0; k < pieces.length && !resolveBidi; k++) {
    const p = pieces[k]!
    if (runIs8bit[p.run]) continue
    for (let s = p.start; s < p.end; s++) if (isUtf16CodeUnitBidi(text.charCodeAt(s))) { resolveBidi = true; break }
  }
  if (resolveBidi) {
    const data = bidiDataFor('gecko')
    const split: Piece[] = []
    let chunk: Piece[] = []
    let chunkText = ''
    const flush = (): void => {
      if (chunk.length === 0) return
      const levels = resolveUnicodeBidi(replaceSeparators(chunkText), paragraph.direction, data).levels
      let offset = 0
      for (let c = 0; c < chunk.length; c++) {
        const p = chunk[c]!
        let s = p.start
        for (let k = p.start + 1; k < p.end; k++) {
          if (levels[offset + k - p.start] !== levels[offset + k - 1 - p.start]) {
            split.push({ run: p.run, start: s, end: k, level: levels[offset + s - p.start]! })
            s = k
          }
        }
        split.push({ run: p.run, start: s, end: p.end, level: levels[offset + s - p.start]! })
        offset += p.end - p.start
      }
      chunk = []
      chunkText = ''
    }
    for (let k = 0; k < pieces.length; k++) {
      const p = pieces[k]!
      let s = p.start
      if (style.newlineIsSignificant) {
        for (let i = p.start; i < p.end; i++) {
          if (text.charCodeAt(i) !== 0x0a) continue
          chunk.push({ run: p.run, start: s, end: i + 1, level: 0 })
          chunkText += text.slice(s, i + 1)
          flush()
          s = i + 1
        }
      }
      if (s < p.end) {
        chunk.push({ run: p.run, start: s, end: p.end, level: 0 })
        chunkText += text.slice(s, p.end)
      }
    }
    flush()
    pieces = split
  }

  // 3. Text runs (ContinueTextRunAcrossFrames, nsTextFrame.cpp:2015-2174) and TransformText per mapped flow.
  const tr: TransformOut = {
    tUnits: new Uint16Array(n), tSource: new Int32Array(n), sourceT: new Int32Array(n).fill(-1), count: 0, hasShy: false,
    hasTab: false,
  }
  const frames: GeckoFrame[] = []
  type RunBuild = { firstFrame: number; frameCount: number; tStart: number; tEnd: number; is8bit: boolean; level: number; hasShy: boolean; hasTab: boolean }
  const builds: RunBuild[] = []
  let inWhitespace = false
  for (let k = 0; k < pieces.length; k++) {
    const p = pieces[k]!
    const prev = k > 0 ? pieces[k - 1]! : null
    const continues = prev !== null && prev.level === p.level && prev.run !== p.run &&
      !(style.newlineIsSignificant && text.charCodeAt(prev.end - 1) === 0x0a) &&
      sameFontForTextRun(runs[prev.run]!.font, runs[p.run]!.font) && langs[prev.run] === langs[p.run] &&
      (letterSpacingAu[prev.run] !== 0) === (letterSpacingAu[p.run] !== 0)
    if (!continues) {
      builds.push({ firstFrame: frames.length, frameCount: 0, tStart: tr.count, tEnd: tr.count, is8bit: true, level: p.level, hasShy: false, hasTab: false })
    }
    const b = builds[builds.length - 1]!
    const tStart = tr.count
    tr.hasShy = false
    tr.hasTab = false
    inWhitespace = transformFlow(text, p.start, p.end, runIs8bit[p.run]!, style, inWhitespace, langs[p.run]!, tr)
    b.hasShy ||= tr.hasShy
    b.hasTab ||= tr.hasTab
    b.is8bit &&= runIs8bit[p.run]!
    b.frameCount++
    b.tEnd = tr.count
    frames.push({ run: p.run, start: p.start, end: p.end, level: p.level, textRun: builds.length - 1, tStart, tEnd: tr.count, is8bit: runIs8bit[p.run]! })
  }
  const T = tr.count
  const tUnits = tr.tUnits.slice(0, T)
  const tSource = tr.tSource.slice(0, T)
  const sourceT = tr.sourceT
  const nextT = new Int32Array(n + 1)
  nextT[n] = T
  for (let s = n - 1; s >= 0; s--) nextT[s] = sourceT[s]! >= 0 ? sourceT[s]! : nextT[s + 1]!

  // 4. Glyph flags per text run.
  const g: Glyphs = { units: tUnits, breakFlags: new Uint8Array(T), clusterStart: new Uint8Array(T).fill(1), isSpace: new Uint8Array(T), kind: new Uint8Array(T) }
  for (let r = 0; r < builds.length; r++) initTextRun(g, builds[r]!.tStart, builds[r]!.tEnd, builds[r]!.is8bit)

  // 5. nsLineBreaker over every flow in order (SetupBreakSinksForTextRun, nsTextFrame.cpp:2889-2997), one scan for the
  //    block: nothing in the model flushes it, so the Chinese/Japanese flag is sticky across words.
  const breaker = new LineBreakerState(env.dictionaryBreaks)
  for (let r = 0; r < builds.length; r++) {
    const b = builds[r]!
    const runState = { noBreaks: true }
    for (let k = b.firstFrame; k < b.firstFrame + b.frameCount; k++) {
      const f = frames[k]!
      breaker.setWordBreak(style.wordBreak)
      breaker.setStrictness(paragraph.lineBreak)
      let flags = 0
      if (!style.wrap) flags |= BREAK_SUPPRESS_INITIAL | BREAK_SUPPRESS_INSIDE // the block controls the initial break
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
        breaker.appendText(langs[f.run]!, tUnits.subarray(f.tStart, f.tEnd), !b.is8bit, flags, sink)
      }
    }
  }
  const trailingBreak = breaker.reset()

  // 6. Spacing after each character (GetSpacingInternal, nsTextFrame.cpp:4089-4295, letter-spacing model 0).
  const runOfT = new Int32Array(T)
  for (let k = 0; k < frames.length; k++) for (let t = frames[k]!.tStart; t < frames[k]!.tEnd; t++) runOfT[t] = frames[k]!.run
  const spacingPrefix = new Int32Array(T + 1)
  for (let r = 0; r < builds.length; r++) {
    const b = builds[r]!
    for (let t = b.tStart; t < b.tEnd; t++) {
      const run = runOfT[t]!
      let spacing = 0
      const ls = letterSpacingAu[run]!
      if (ls !== 0) {
        // CanAddSpacingAfter (nsTextFrame.cpp:3860-3873).
        const canAdd = !(style.newlineIsSignificant && g.kind[t] === KIND_NEWLINE) &&
          (t + 1 >= b.tEnd || (g.clusterStart[t + 1] === 1 && g.kind[t] !== KIND_FORMAT && g.kind[t] !== KIND_TAB))
        if (canAdd) {
          let base = t
          while (base > b.tStart && g.clusterStart[base] === 0) base--
          let cp = tUnits[base]!
          if (base + 1 < b.tEnd && isSurrogatePair(cp, tUnits[base + 1]!)) cp = combine(cp, tUnits[base + 1]!)
          if (!isCursiveScript(cp)) spacing += ls
        }
      }
      const ws = wordSpacingAu[run]!
      if (ws !== 0) {
        // IsCSSWordSpacingSpace on the original character (nsTextFrame.cpp:880-898).
        const s = tSource[t]!
        const ch = text.charCodeAt(s)
        const f = frames[frameOfSource(frames, s)]!
        if (((ch === 0x20 || ch === 0xa0) && !isSpaceCombiningSequenceTail(text, s + 1, f.end)) ||
          ((ch === 0x0d || ch === 0x09) && !style.whiteSpaceIsSignificant) || (ch === 0x0a && !style.newlineIsSignificant)) spacing += ws
      }
      spacingPrefix[t + 1] = spacingPrefix[t]! + spacing
    }
  }

  // 7. Measurement: one context per text run (specs/gecko-canvas.md §2 A1, A6), units measured whole (A4, E1, E2).
  const unitOf = new Int32Array(T)
  const units: GeckoUnit[] = []
  const correction = new Int32Array(T)
  const textRuns: GeckoTextRun[] = []
  const quantizationReported = new Set<string>()
  const opticalSizeReported = new Set<string>()
  let emojiGapReported = false
  let fallbackGapReported = false
  let spaceShapingGapReported = false
  for (let r = 0; r < builds.length; r++) {
    const b = builds[r]!
    const firstRun = frames[b.firstFrame]!.run
    const font = runs[firstRun]!.font
    const lang = langs[firstRun]!
    const domAu = lroundf(f32(quantize10(font.size) * 60))
    if (quantize7(font.size) * 60 !== domAu && !quantizationReported.has(String(font.size))) {
      quantizationReported.add(String(font.size))
      gaps.push({ gap: 'font-size-quantization', run: firstRun, detail: `DOM size ${domAu / 60}px, Canvas size ${quantize7(font.size)}px` })
    }
    // No Canvas setting gives the DOM's auto optical sizing (specs/gecko-canvas.md §1.2 C1a), so a font with an opsz axis,
    // or one whose axis isn't known, may measure differently (DESIGN.md §1.2).
    if (font.facts.opticalSizeAxis !== false && !opticalSizeReported.has(font.family)) {
      opticalSizeReported.add(font.family)
      gaps.push({ gap: 'optical-size', run: firstRun, detail: font.facts.opticalSizeAxis === true ? `${font.family} has an opsz axis` : `whether ${font.family} has an opsz axis isn't given (default ${opticalSizeAxisOf(font)})` })
    }
    // CanAddSpacingAfter adds letter spacing only at ligature group starts (nsTextFrame.cpp:3860-3873). Letter spacing
    // turns optional ligatures off; the required ligatures a font still forms aren't visible to Canvas.
    if (letterSpacingAu[firstRun] !== 0) gaps.push({ gap: 'glyph-clusters', run: firstRun, detail: "letter spacing follows ligature group starts, which Canvas can't show (nsTextFrame.cpp:3860-3873)" })
    const settings = {
      font: canvasFont(font, font.size), lang, letterSpacing: letterSpacingAu[firstRun] !== 0 ? '0.001px' : '0px',
      wordSpacing: '0px', fontKerning: 'auto' as const, textRendering: 'auto' as const,
      direction: (b.level & 1) === 1 ? 'rtl' as const : 'ltr' as const, partition: '',
    }
    const context = measureContext(measurer, settings)
    const auIn = (ctx: number, s: string) => Math.round(measureText(measurer, ctx, s) * 60)
    const au = (s: string) => auIn(context, s)
    let advance = 0
    const run = { context, scriptRuns: textRunScripts(tUnits, b.tStart, b.tEnd, b.is8bit), tStart: b.tStart }
    let stretchStart = b.tStart
    let stretchWords = 0
    let stretchSpaces = 0
    let stretchSum = 0
    const endStretch = (end: number): void => {
      if (stretchWords >= 2 && stretchSpaces >= 1) {
        let s = ''
        for (let t = stretchStart; t < end; t++) s += String.fromCharCode(tUnits[t]!)
        if (au(s) !== stretchSum && !spaceShapingGapReported) {
          spaceShapingGapReported = true
          gaps.push({ gap: 'space-in-shaping', run: firstRun, detail: `the whole range measures ${au(s)} au, its units ${stretchSum} au` })
        }
      }
      stretchWords = 0
      stretchSpaces = 0
      stretchSum = 0
    }
    for (let t = b.tStart; t < b.tEnd;) {
      const ch = tUnits[t]!
      const next = t + 1 < b.tEnd ? tUnits[t + 1]! : 0x0a
      const boundary = (ch === 0x20 || ch === 0xa0) && (b.is8bit || !isClusterExtender(next))
      const invalid = !boundary && (b.is8bit ? isInvalidChar8(ch) : isInvalidChar16(ch))
      let unit: GeckoUnit
      if (boundary) {
        const w = au(ch === 0x20 ? ' ' : ' ')
        unit = { kind: ch === 0x20 ? 'space' : 'nbsp', tStart: t, tEnd: t + 1, canvasAu: w, au: w, startAdvance: advance }
        stretchSpaces++
        stretchSum += w
      } else if (invalid) {
        endStretch(t)
        stretchStart = t + 1
        unit = { kind: 'invalid', tStart: t, tEnd: t + 1, canvasAu: 0, au: 0, startAdvance: advance }
      } else {
        let e = t + 1
        for (; e < b.tEnd; e++) {
          const c = tUnits[e]!
          const nx = e + 1 < b.tEnd ? tUnits[e + 1]! : 0x0a
          if (((c === 0x20 || c === 0xa0) && (b.is8bit || !isClusterExtender(nx))) || (b.is8bit ? isInvalidChar8(c) : isInvalidChar16(c))) break
        }
        const w = rangeAu(measurer, run, tUnits, t, e)
        let total = w
        if (apd !== 60 && !b.is8bit) {
          // Apple Color Emoji is an sbix font: the DOM takes its advances from Core Text at the device size, Canvas at the
          // CSS size (gfxMacFont.cpp:437-463; specs/gecko-canvas.md §1.9, §2 A12). Which font draws a cluster is font
          // matching's decision (gfxFontGroup::FindFontForChar, gfxTextRun.cpp:3178-3600), and the document's fallback
          // history changes it: after one U+1F600 U+FE0E, Canvas and the DOM both draw U+1F600 with a text font (probes
          // gecko-port F2, F3). Canvas shows which: Apple Color Emoji draws the cluster when it measures the same in the
          // run's font list as in "Apple Color Emoji" alone, at the CSS size and at the device size (F3, 16px Arial:
          // fresh 1260 and 1920 au in both; pinned 1020 au in Arial and 1260 au in Apple Color Emoji, DOM 1020 au).
          const devSize = domAu / apd
          const deviceContext = measureContext(measurer, { ...settings, font: canvasFont(font, devSize) })
          const emojiFontContext = (size: number) => measureContext(measurer, { ...settings, font: canvasFont({ ...font, family: COLOR_EMOJI_FAMILY }, size) })
          let word = ''
          for (let k = t; k < e; k++) word += String.fromCharCode(tUnits[k]!)
          const boundaries = graphemeBoundaries(word, graphemeRules)
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
            const atCssSize = au(cluster)
            const inEmojiFont = atCssSize === auIn(emojiFontContext(font.size), cluster) &&
              auIn(deviceContext, cluster) === auIn(emojiFontContext(devSize), cluster)
            if (!inEmojiFont) {
              const next = cluster.codePointAt(first >= 0x10000 ? 2 : 1) ?? 0
              if (prefersColorGlyph(presentation, first, next) && !fallbackGapReported) {
                fallbackGapReported = true
                gaps.push({ gap: 'font-fallback', run: firstRun, detail: `U+${first.toString(16).toUpperCase()} asks for a color glyph, but Canvas draws it with another font than Apple Color Emoji (${atCssSize} au): the document's font fallback has pinned it, and the DOM follows the state at its own layout time (probes gecko-port F2, F3)` })
              }
              continue
            }
            if (quantize7(devSize) !== devSize && !emojiGapReported) {
              emojiGapReported = true
              gaps.push({ gap: 'bitmap-emoji-size', run: firstRun, detail: `device size ${devSize}px is not on Canvas's 7-bit size grid` })
            }
            // The DOM stores floor(apd × device advance + 0.5) (gfxHarfBuzzShaper.cpp:1559); a lone regional indicator's
            // advance isn't a whole pixel (28.683px at 28px), so round once from the Canvas au at the device size.
            const deviceAu60 = auIn(deviceContext, cluster)
            const dom = Math.floor(deviceAu60 * apd / 60 + 0.5)
            if ((deviceAu60 * apd) % 60 !== 0 && !emojiGapReported) {
              // Canvas's au at the device size rounds once at apd 60; the DOM rounds at the page's apd, and adds synthetic
              // bold after rounding (gfxFont.cpp:3551-3562), so the DOM value isn't determined (+1 au per bold flag, runs-r4).
              emojiGapReported = true
              gaps.push({ gap: 'bitmap-emoji-size', run: firstRun, detail: `device-size advance ${deviceAu60} au at apd 60 doesn't give an exact au at apd ${apd}` })
            }
            const delta = dom - atCssSize
            correction[t + boundaries[c]!] = delta
            total += delta
          }
        }
        unit = { kind: 'word', tStart: t, tEnd: e, canvasAu: w, au: total, startAdvance: advance }
        stretchWords++
        stretchSum += w
      }
      for (let k = unit.tStart; k < unit.tEnd; k++) unitOf[k] = units.length
      units.push(unit)
      advance += unit.au
      t = unit.tEnd
    }
    endStretch(b.tEnd)
    textRuns.push({
      tStart: b.tStart, tEnd: b.tEnd, is8bit: b.is8bit, level: b.level, context, scriptRuns: run.scriptRuns, hasShy: b.hasShy,
      trailingBreak: r === builds.length - 1 && trailingBreak, minTabAdvance: b.hasTab ? 0.5 * au('0') : 0,
      hyphenAu: b.hasShy ? au('‐') : 0, hasTab: b.hasTab, totalAdvance: advance,
    })
  }
  const correctionPrefix = new Int32Array(T + 1)
  for (let t = 0; t < T; t++) correctionPrefix[t + 1] = correctionPrefix[t]! + correction[t]!

  // ComputeTabWidthAppUnits (nsTextFrame.cpp:3875-3906): tab-size spaces of the containing block's space, plus its
  // letter and word spacing.
  let tabWidth = 0
  for (let r = 0; r < textRuns.length; r++) {
    if (!textRuns[r]!.hasTab) continue
    const context = measureContext(measurer, {
      font: canvasFont(paragraph.font, paragraph.font.size), lang: paragraph.lang,
      letterSpacing: pxToAu(paragraph.letterSpacing) !== 0 ? '0.001px' : '0px', wordSpacing: '0px', fontKerning: 'auto',
      textRendering: 'auto', direction: 'ltr', partition: '',
    })
    const space = Math.round(measureText(measurer, context, ' ') * 60)
    tabWidth = paragraph.tabSize * (space + pxToAu(paragraph.letterSpacing) + pxToAu(paragraph.wordSpacing))
    break
  }

  // Text of a language ICU4X breaks with its LSTM models (complex/language.rs:17-45, linebreak.ts segmentComplex).
  switch (env.dictionaryBreaks.kind) {
    case 'intl-segmenter-word':
      break
    case 'unavailable': {
      let hasComplex = false
      for (let s = 0; s < n && !hasComplex; s++) hasComplex = complexLanguage(text.charCodeAt(s)) !== ''
      if (hasComplex) gaps.push({ gap: 'dictionary-breaks-unavailable', run: null, detail: 'Thai, Lao, Khmer or Myanmar text' })
      break
    }
  }
  // gfxFont::SynthesizeSpaceWidth gives a U+2007 or U+2008 that no font in the list covers the font's figure or space width,
  // rounded to whole device pixels (gfxTextRun.cpp:3032-3043, gfxFont.cpp:4809-4814). Canvas rounds at apd 60 and shows
  // neither whether a font covers it nor the unrounded width.
  if (apd !== 60) {
    for (let s = 0; s < n; s++) {
      const u = text.charCodeAt(s)
      if (u !== 0x2007 && u !== 0x2008) continue
      let run = 0
      while (runStarts[run + 1]! <= s) run++
      gaps.push({ gap: 'font-fallback', run, detail: `U+${u.toString(16).toUpperCase()} takes a synthesized width rounded to device pixels where no font covers it` })
      break
    }
  }

  return {
    paragraph, env, appUnitsPerDevPixel: apd, style, text, runStarts, letterSpacingAu, frames, textRuns, tUnits, tSource,
    breakFlags: g.breakFlags, clusterStart: g.clusterStart, isSpace: g.isSpace, kind: g.kind, spacingPrefix,
    correctionPrefix, unitOf, units, sourceT, nextT, tabWidth, gaps,
  }
}

export function frameOfSource(frames: GeckoFrame[], s: number): number {
  let lo = 0
  let hi = frames.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (frames[mid]!.start <= s) lo = mid
    else hi = mid - 1
  }
  return lo
}

export { BREAK_NORMAL }
