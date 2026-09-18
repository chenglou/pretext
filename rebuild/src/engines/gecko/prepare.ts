// Content building for Gecko (Firefox 156.0): frames, bidi splits, text runs, TransformText per mapped flow, glyph
// flags, nsLineBreaker breaks, spacing and the app-unit advances known before lines are filled.
// specs/gecko-text.md §2-§12, specs/gecko-canvas.md §2-§3, specs/probes-firefox.md.
import { indexContent, langUnder, styleUnder, type ContentIndex } from '../../content.js'
import type { GeckoEnvironment } from '../../env.js'
import { measureContext, measureText, measureTextBounds, type Measurer } from '../../measure/canvas.js'
import { canvasFont } from '../../measure/font.js'
import type { BoxEdge, FontDecl, Gap, Paragraph, TextStyle } from '../../model.js'
import { extenderFontOf, firstFontScriptLookups, listedFontOf, opticalSizeAxisOf, quantize10, sameFontForTextRun } from './fonts.js'
import { canonicalLanguageTag } from './likely.js'
import { AL, R, bidiClassOf, bidiDataFor } from '../../unicode/bidi.js'
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
  KIND_FORMAT, KIND_GLYPH, KIND_INVISIBLE, KIND_NEWLINE, KIND_TAB, type GeckoElement, type GeckoFrame, type GeckoItem,
  type GeckoPrepared, type GeckoSpanEdges, type GeckoStyle, type GeckoTextRun, type GeckoUnit, type ScriptRun,
} from './types.js'

const f32 = Math.fround
const SHY = 0x00ad
// measureText's width is `float(au) / apd`, a float (:5277), with apd 60 on an OffscreenCanvas and the page's on a canvas
// element. Below 2^18 px a float32 step is at most 1/64 px, so the value is within 1/128 px, under half an app unit at
// either apd, and rounds back to the au; from 2^18 px on a step is 1/32 px and the app units are lost.
const CANVAS_EXACT_PX = 2 ** 18

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

// The script runs gfxFontGroup::InitTextRun shapes [start, end) with (gfxTextRun.cpp:2729-2757): text with every code
// unit below U+02EA is one run, Latin when it has a Latin letter, else Common resolved from the language; other text goes
// through the itemizer. Common stays Common here, standing for "resolved from the language". An 8-bit text run tests
// `const uint8_t c = aString[j] & ~0x20; hasLetter = (c - 'A' <= 'Z' - 'A')` (:2744-2747): `c - 'A'` is a signed int, so
// every unit whose masked value is at most 'Z' counts, digits, spaces and ASCII punctuation included. Probe gecko-port F8
// (.artifacts/probes/gecko/round2): ` 7:00-9:00` in 18px bold "Apple SD Gothic Neo" under lang="ko" kerns `7:` and `-9` as
// an 8-bit node (5184 au) and doesn't within a 16-bit text run (4969 au), where Common resolves to Hangul and CJK scripts
// turn kerning off (gfxHarfBuzzShaper.cpp:1405-1438).
function textRunScripts(units: Uint16Array, start: number, end: number, is8bit: boolean): ScriptRun[] {
  let allCommonOrLatin = true
  for (let i = start; i < end; i++) if (units[i]! >= 0x02ea) { allCommonOrLatin = false; break }
  if (!allCommonOrLatin) return scriptRunLimits(units, start, end)
  let hasLetter = false
  for (let i = start; i < end && !hasLetter; i++) {
    const u = units[i]!
    hasLetter = is8bit ? (u & 0xdf) <= 0x5a : fastLatin(u)
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
  // An 8-bit text run is Latin without a Latin letter (textRunScripts), and Canvas's 16-bit string itemizes Latin only with
  // one: a letter of its own gives it that script. Probe gecko-port F8: `a 7:00-9:00` less `a ` in 18px bold "Apple SD Gothic
  // Neo" with lang ko is 4900 au, the DOM's width of the 8-bit node, where `7:00-9:00` alone is 4969 au.
  if (domScript === 'Latn') return { text: 'a', before: true }
  return null
}

// The Canvas au of transformed text [tStart, tEnd) of one shaping unit, shaped in the script the paragraph gives it:
// `context + ' ' + piece` less `context + ' '` (or the mirror) where scriptContextFor names a context. U+0020 is a shaping
// word boundary that nothing kerns across (gfxFont.cpp:3781-3866), and in the Canvas text run the space and the piece's
// Common characters join the context's script run. Units, suffixes and prefixes all go through this one recipe.
// `before` and `after` are put around the piece: U+200D where the piece is cut between joined letters (lines.ts).
export function rangeAu(m: Measurer, run: Pick<GeckoTextRun, 'context' | 'scriptRuns' | 'tStart' | 'auPerPx'>, units: Uint16Array,
  tStart: number, tEnd: number, before = '', after = ''): number {
  let piece = before
  for (let k = tStart; k < tEnd; k++) piece += String.fromCharCode(units[k]!)
  piece += after
  // Canvas gives a string of one character, or of one surrogate pair, a direction of its own: right to left for the bidi
  // classes R and AL, else left to right, whatever ctx.direction says (nsBidiPresUtils::ProcessText and ProcessSimpleRun,
  // nsBidiPresUtils.cpp:2180-2190, :2395-2414). The DOM shapes the character at its resolved level, so a neutral at an odd
  // level is mirrored there and not in Canvas (fresh c-a76a521c12628bd7: `(` alone at level 1 in 16px Shantell Sans is 392
  // au natively, the advance of `)`, and 420 au in a right-to-left context). U+200C after it makes the string two characters,
  // which takes Canvas's bidi path, where a neutral gets the context's direction; it is a join control, drawn with no
  // advance by the font before it (gfxTextRun.cpp:3309-3332). Only a mirrored character gets it: direction reaches a lone
  // character's glyph through hb_ot_rotate_chars, which in a backward direction swaps a character for its Bidi_Mirroring
  // partner where the font has it and else asks for the font's `rtlm` form (hb-ot-shape.cc:650-670); the other way in is a
  // font's `rtla` lookups (:339-340), which the port doesn't predict. Elsewhere the second character isn't free: a lone
  // mark shapes otherwise with U+200C after it (held-out c-0b2ac06557b89cf6: U+0301 alone at level 1 in 16px Georgia is
  // 480 au natively and alone in Canvas, and nothing with U+200C after it).
  if (m.log.contexts[run.context]!.direction === 'rtl' && (piece.length === 1 || (piece.length === 2 && isSurrogatePair(piece.charCodeAt(0), piece.charCodeAt(1))))) {
    const cp = piece.codePointAt(0)!
    const bidiClass = bidiClassOf(bidiDataFor('gecko'), cp)
    if (bidiClass !== R && bidiClass !== AL && isBidiMirrored(cp)) piece += '\u200c'
  }
  const w = (s: string) => Math.round(measureText(m, run.context, s) * run.auPerPx)
  // gfxFontGroup::ComputeRanges matches fonts over the whole script run, carrying the previous character and its matched font
  // (gfxTextRun.cpp:3593-3875), and FindFontForChar reads them for a cluster extender and U+202F (:3181-3212). A piece that
  // starts with one right after an invalid character begins a shaping unit, so the text before it shapes apart
  // (gfxFont.cpp:3872-3897), and Canvas reproduces the DOM's advances with the script run's earlier text in front. Probe
  // gecko-port F4 (.artifacts/probes/gecko/font-matching): `a WJ U+0301 ZWSP U+0308 U+093E b` in 16px Arial is 1329 au whole
  // as in the DOM, where `U+0308 U+093E b` alone and after ZWSP measure 1429 au; `x U+2028 U+202F` gives U+202F 0 au whole
  // as in the DOM and 192 au alone.
  if (tStart > run.tStart && tStart < tEnd && isInvalidChar16(units[tStart - 1]!) && (isClusterExtender(units[tStart]!) || units[tStart] === 0x202f)) {
    let from = run.tStart
    for (let k = 0; k < run.scriptRuns.length && run.scriptRuns[k]!.limit <= tStart; k++) from = run.scriptRuns[k]!.limit
    let prefix = ''
    for (let k = from; k < tStart; k++) prefix += String.fromCharCode(units[k]!)
    return w(prefix + piece) - w(prefix)
  }
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

// gfxFont::GetSyntheticBoldOffset (gfxFont.h:1899-1904), in device px of the font's size.
const syntheticBoldOffset = (size: number): number => size < 48 ? 0.25 + 0.75 * size / 48 : size / 48

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
// The DOM children of the block in order, for the white-space-only text node rule: a leaf with empty text makes no node.
function blockChildNodes(index: ContentIndex<FontDecl>): Array<{ kind: 'leaf'; run: number } | { kind: 'element'; element: number }> {
  const out: Array<{ kind: 'leaf'; run: number } | { kind: 'element'; element: number }> = []
  for (let e = 0; e < index.events.length; e++) {
    const event = index.events[e]!
    if (event.kind === 'text') {
      const leaf = index.leaves[event.run]!
      if (leaf.parent === -1 && leaf.text.length > 0) out.push({ kind: 'leaf', run: event.run })
    } else if (event.kind !== 'close' && index.elements[event.element]!.parent === -1) {
      out.push({ kind: 'element', element: event.element })
    }
  }
  return out
}

// snap_as_border_width (servo/components/style/values/specified/border.rs:235-246): a nonzero border width rounds down to
// whole device pixels, and to at least one.
function borderAu(px: number, apd: number): number {
  const au = pxToAu(px)
  return au === 0 ? 0 : Math.max(apd, Math.trunc(au / apd) * apd)
}

export function prepareGecko(paragraph: Paragraph, env: GeckoEnvironment, measurer: Measurer): GeckoPrepared {
  const blockStyle = geckoStyle(paragraph)
  const apd = Math.max(1, Math.floor(60 / env.devicePixelRatio + 0.5)) // nsDeviceContext.cpp:52-63
  const index = indexContent(paragraph)
  const leaves = index.leaves
  const text = index.text
  const n = text.length
  const runStarts: number[] = []
  for (let i = 0; i < leaves.length; i++) runStarts.push(leaves[i]!.start)
  runStarts.push(n)
  const gaps: Gap[] = []
  const letterSpacingAu: number[] = []
  const wordSpacingAu: number[] = []
  const langs: string[] = []
  const runIs8bit: boolean[] = []
  const runTextStyles: TextStyle[] = []
  const runStyles: GeckoStyle[] = []
  const runParents: number[] = []
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]!
    // A text frame reads its parent element's computed style: a text node inherits every property the model has.
    const style = styleUnder(paragraph, index, leaf.parent)
    runTextStyles.push(style)
    runStyles.push(geckoStyle(style))
    runParents.push(leaf.parent)
    letterSpacingAu.push(pxToAu(style.letterSpacing))
    wordSpacingAu.push(pxToAu(style.wordSpacing))
    langs.push(canonicalLanguageTag(langUnder(paragraph, index, leaf.parent)))
    let is8bit = true
    for (let k = 0; k < leaf.text.length; k++) if (leaf.text.charCodeAt(k) >= 0x100) { is8bit = false; break }
    runIs8bit.push(is8bit)
    // lang="" leaves the style language empty (MapLangAttributeInto, nsGenericHTMLElement.cpp:1337-1375), and nsFontCache gives
    // such text the locale language, the first regional-prefs locale lowercased (nsFontCache.cpp:34, :61-63;
    // nsLanguageAtomService.cpp:107-138), for font matching and shaping. Line breaking and TransformText still see the empty
    // tag. The measure contexts take that locale when the caller gives it; otherwise it can't be known.
    if (langs[i] === '' && env.regionalPrefsLocale === null) gaps.push({ gap: 'ui-language', run: i, detail: 'lang="": font lists and generic families follow the OS regional-prefs locale, which pages cannot read (nsFontCache.cpp:61-63)', at: { start: leaf.start, end: leaf.start + leaf.text.length } })
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
  // `para`: the bidi paragraph the piece was resolved in (0 without bidi).
  type Piece = { run: number; start: number; end: number; level: number; para: number }
  const children = blockChildNodes(index)
  const boundaryLeaves = new Set<number>()
  const firstChild = children[0]
  const lastChild = children[children.length - 1]
  if (firstChild !== undefined && firstChild.kind === 'leaf') boundaryLeaves.add(firstChild.run)
  if (lastChild !== undefined && lastChild.kind === 'leaf') boundaryLeaves.add(lastChild.run)
  let pieces: Piece[] = []
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]!
    if (leaf.text.length === 0) continue
    if (boundaryLeaves.has(i) && runStyles[i]!.collapse === 'collapse' && runIs8bit[i]) {
      let onlyWhitespace = true
      for (let k = 0; k < leaf.text.length; k++) {
        const u = leaf.text.charCodeAt(k)
        if (u !== 0x20 && u !== 0x09 && u !== 0x0a && u !== 0x0d && u !== 0x0c) { onlyWhitespace = false; break }
      }
      if (onlyWhitespace) continue
    }
    pieces.push({ run: i, start: runStarts[i]!, end: runStarts[i + 1]!, level: 0, para: 0 })
  }

  // 2. Bidi (nsBidiPresUtils.cpp:790-1167): resolve when the block is RTL or a 16-bit node has RTL characters; each
  //    preserved line is its own paragraph, and frames split where the level run ends.
  let resolveBidi = rtlBlock
  for (let k = 0; k < pieces.length && !resolveBidi; k++) {
    const p = pieces[k]!
    if (runIs8bit[p.run]) continue
    for (let s = p.start; s < p.end; s++) if (isUtf16CodeUnitBidi(text.charCodeAt(s))) { resolveBidi = true; break }
  }
  // The document resolves bidi once any text node holds a bidi code unit (CharacterData.cpp:298-302; nsBlockFrame.cpp:863-864),
  // whatever this paragraph holds. An LTR paragraph with left-to-right embedding, override or isolate controls and no
  // right-to-left character then splits frames at the level changes those controls make, and frames at different levels
  // don't share a text run (nsTextFrame.cpp:2139-2148). The port predicts a fresh document (gecko audit F3).
  if (!resolveBidi) {
    for (let k = 0; k < pieces.length; k++) {
      const p = pieces[k]!
      let found = false
      for (let s = p.start; s < p.end && !found; s++) {
        const u = text.charCodeAt(s)
        found = u === 0x202a || u === 0x202d || u === 0x2066 || u === 0x2068
      }
      if (found) {
        gaps.push({ gap: 'page-history', run: p.run, detail: "left-to-right bidi controls split frames only once the document has seen right-to-left text (CharacterData.cpp:298-302, nsTextFrame.cpp:2139-2148); the port predicts a fresh document", at: { start: p.start, end: p.end } })
      }
    }
  }
  let paraCount = 0
  const elementPara = new Map<number, number>()
  if (resolveBidi) {
    const data = bidiDataFor('gecko')
    const split: Piece[] = []
    // TraverseFrames' paragraph buffer in document order (nsBidiPresUtils.cpp:1169-1429): each text piece's text, and one
    // character per other leaf, whose run gives that frame its level (ResolveParagraph :975-982, :1027). A <br> appends
    // U+2028 and ends the bidi paragraph (:1381-1384); an atomic inline is U+FFFC and a <wbr> U+200B (:1385-1400). An
    // inline-block is inline-outside, so it doesn't end the paragraph. A span without children would be a leaf as U+200B,
    // a boundary-neutral character that only gives the span its own level; the model gives empty spans no leaf.
    type Entry = { kind: 'piece'; piece: Piece } | { kind: 'object'; element: number }
    let chunk: Entry[] = []
    let chunkText = ''
    const flush = (): void => {
      if (chunk.length === 0) return
      const levels = resolveUnicodeBidi(replaceSeparators(chunkText), paragraph.direction, data).levels
      const para = paraCount++
      let offset = 0
      for (let c = 0; c < chunk.length; c++) {
        const entry = chunk[c]!
        if (entry.kind === 'object') {
          (elements[entry.element] as Extract<GeckoElement, { kind: 'atomic' | 'br' | 'wbr' }>).level = levels[offset]!
          elementPara.set(entry.element, para)
          offset++
          continue
        }
        const p = entry.piece
        let s = p.start
        for (let k = p.start + 1; k < p.end; k++) {
          if (levels[offset + k - p.start] !== levels[offset + k - 1 - p.start]) {
            split.push({ run: p.run, start: s, end: k, level: levels[offset + s - p.start]!, para })
            s = k
          }
        }
        split.push({ run: p.run, start: s, end: p.end, level: levels[offset + s - p.start]!, para })
        offset += p.end - p.start
      }
      chunk = []
      chunkText = ''
    }
    const pieceOfRun = new Map<number, Piece>()
    for (let k = 0; k < pieces.length; k++) pieceOfRun.set(pieces[k]!.run, pieces[k]!)
    for (let ev = 0; ev < index.events.length; ev++) {
      const event = index.events[ev]!
      switch (event.kind) {
        case 'text': {
          const p = pieceOfRun.get(event.run)
          if (p === undefined) break
          let s = p.start
          if (runStyles[p.run]!.newlineIsSignificant) {
            for (let i = p.start; i < p.end; i++) {
              if (text.charCodeAt(i) !== 0x0a) continue
              chunk.push({ kind: 'piece', piece: { run: p.run, start: s, end: i + 1, level: 0, para: 0 } })
              chunkText += text.slice(s, i + 1)
              flush()
              s = i + 1
            }
          }
          if (s < p.end) {
            chunk.push({ kind: 'piece', piece: { run: p.run, start: s, end: p.end, level: 0, para: 0 } })
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
  const splitBeforeEvent = new Set<number>()
  const splitBeforePiece = new Set<Piece>()
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
              if (k > 0) splitBeforePiece.add(piece)
              else splitBeforeEvent.add(insertAt === -1 ? ev : insertAt)
            }
            prevLevel = piece.level
            prevPara = piece.para
          }
          if (list.length > 0) insertAt = -1
          break
        }
        default: {
          const el = elements[event.element] as Extract<GeckoElement, { kind: 'atomic' | 'br' | 'wbr' }>
          const para = elementPara.get(event.element) ?? -2
          if (prevPara === para && prevLevel !== el.level) splitBeforeEvent.add(insertAt === -1 ? ev : insertAt)
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
  type RunBuild = { flows: Flow[]; tStart: number; tEnd: number; is8bit: boolean; level: number; hasShy: boolean; hasTab: boolean; trailingBreak: boolean }
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
    const prevStyle = runStyles[prevFrame.run]!
    if (prevStyle.newlineIsSignificant && text.charCodeAt(prevFrame.end - 1) === 0x0a) return false // HasTerminalNewline
    const parentA = runParents[prevFrame.run]!
    const parentB = runParents[p.run]!
    if (parentA !== parentB) {
      const up = new Set(ancestorsOf(parentA))
      let ancestor = -1
      const down = ancestorsOf(parentB)
      for (let k = 0; k < down.length; k++) if (up.has(down[k]!)) { ancestor = down[k]!; break }
      // The inline end of the first frame's boxes and the inline start of the second's, swapped when the first frame's
      // embedding level is against the block's direction (nsTextFrame.cpp:2112-2126).
      const swap = ((prevFrame.level & 1) === 1) === !rtlBlock
      if (preventsShaping(parentA, ancestor, swap ? 'start' : 'end') || preventsShaping(parentB, ancestor, swap ? 'end' : 'start')) return false
    }
    if (prevFrame.run === p.run) return false // a non-fluid continuation of the same node (:2130-2139)
    if (parentA === parentB) return true // one computed style (:2141-2143)
    const a = runTextStyles[prevFrame.run]!
    const b = runTextStyles[p.run]!
    return prevStyle.wordBreak === runStyles[p.run]!.wordBreak && a.lineBreak === b.lineBreak &&
      sameFontForTextRun(a.font, b.font) && langs[prevFrame.run] === langs[p.run] &&
      (letterSpacingAu[prevFrame.run] !== 0) === (letterSpacingAu[p.run] !== 0)
  }
  let offsetAt = 0
  const openStack: number[] = []
  // A bidi split: the open spans' continuations end, innermost first, and new ones begin (SplitInlineAncestors). The scanner
  // lifts the common ancestor past each ended continuation as it does past a span (nsTextFrame.cpp:2275).
  const emitSplit = (at: number): void => {
    for (let d = openStack.length - 1; d >= 0; d--) {
      const e = openStack[d]!
      const el = elements[e] as Extract<GeckoElement, { kind: 'span' }>
      el.closes.push(items.length)
      items.push({ kind: 'close', element: e, at, split: true })
      if (commonAncestor === e) commonAncestor = el.parent
    }
    for (let d = 0; d < openStack.length; d++) items.push({ kind: 'open', element: openStack[d]!, at, split: true })
  }
  for (let ev = 0; ev < index.events.length; ev++) {
    const event = index.events[ev]!
    if (splitBeforeEvent.has(ev)) emitSplit(offsetAt)
    switch (event.kind) {
      case 'text': {
        const pieceList = leafPieces[event.run]!
        for (let k = 0; k < pieceList.length; k++) {
          const p = pieceList[k]!
          if (splitBeforePiece.has(p)) emitSplit(p.start)
          if (current === null || lastFrame < 0 || !continuesAcross(frames[lastFrame]!, p)) {
            flushRun()
            current = { flows: [], tStart: tr.count, tEnd: tr.count, is8bit: true, level: p.level, hasShy: false, hasTab: false, trailingBreak: false }
          }
          const b: RunBuild = current
          const tStart = tr.count
          tr.hasShy = false
          tr.hasTab = false
          inWhitespace = transformFlow(text, p.start, p.end, runIs8bit[p.run]!, runStyles[p.run]!, inWhitespace, langs[p.run]!, tr)
          b.hasShy ||= tr.hasShy
          b.hasTab ||= tr.hasTab
          b.is8bit &&= runIs8bit[p.run]!
          b.tEnd = tr.count
          const fi = frames.length
          // A new mapped flow records the common ancestor with the last frame as the element controlling its initial break
          // (nsTextFrame.cpp:2229-2233); AccumulateRunInfo then makes the frame's parent the common ancestor (:1886-1888).
          b.flows.push({ frame: fi, initialBreakController: commonAncestor })
          frames.push({ run: p.run, start: p.start, end: p.end, level: p.level, textRun: builds.length, tStart, tEnd: tr.count, is8bit: runIs8bit[p.run]!, item: items.length })
          items.push({ kind: 'text', frame: fi, at: p.start })
          lastFrame = fi
          commonAncestor = runParents[p.run]!
        }
        offsetAt += leaves[event.run]!.text.length
        break
      }
      case 'open': {
        const el = elements[event.element] as Extract<GeckoElement, { kind: 'span' }>
        el.open = items.length
        items.push({ kind: 'open', element: event.element, at: offsetAt, split: false })
        openStack.push(event.element)
        break
      }
      case 'close': {
        const el = elements[event.element] as Extract<GeckoElement, { kind: 'span' }>
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
        const el = elements[event.element] as Extract<GeckoElement, { kind: 'atomic' | 'br' | 'wbr' }>
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
  for (let s = n - 1; s >= 0; s--) nextT[s] = sourceT[s]! >= 0 ? sourceT[s]! : nextT[s + 1]!

  // 4. Glyph flags per text run.
  const g: Glyphs = { units: tUnits, breakFlags: new Uint8Array(T), clusterStart: new Uint8Array(T).fill(1), isSpace: new Uint8Array(T), kind: new Uint8Array(T) }
  for (let r = 0; r < builds.length; r++) initTextRun(g, builds[r]!.tStart, builds[r]!.tEnd, builds[r]!.is8bit)
  // The emergency break after a hyphen is set inside one shaped word (SetupClusterBoundaries, gfxFont.cpp:741-753), and
  // InitScriptRun shapes a word per font range (gfxTextRun.cpp:2930-3000): it exists only where the letter before the
  // hyphen, the hyphen and the letter after it are one font's. The coverage facts say which listed family draws each
  // (fonts.ts listedFontOf). One family for all three keeps the flag, two families or a listed one next to the engine's
  // fallback take it away, and where the facts don't say, or all three fall back, the line it decides reports font-fallback.
  const emergencyUnconfirmed = new Set<number>()
  for (let r = 0; r < builds.length; r++) {
    const b = builds[r]!
    if (b.flows.length === 0) continue
    const font = runTextStyles[frames[b.flows[0]!.frame]!.run]!.font
    for (let t = b.tStart + 2; t < b.tEnd; t++) {
      if (g.breakFlags[t] !== BREAK_EMERGENCY_WRAP) continue
      const before = listedFontOf(font, tUnits[t - 2]!)
      const hyphen = listedFontOf(font, tUnits[t - 1]!)
      const after = listedFontOf(font, tUnits[t]!)
      if (before === null || hyphen === null || after === null || (before === -1 && hyphen === -1 && after === -1)) emergencyUnconfirmed.add(t)
      else if (before !== hyphen || hyphen !== after) g.breakFlags[t] = BREAK_NONE
    }
  }

  // 5. nsLineBreaker over every flow in document order (SetupBreakSinksForTextRun, nsTextFrame.cpp:2889-2997), with the
  //    resets of frames text can't cross.
  const breaker = new LineBreakerState(env.dictionaryBreaks)
  const styleOfElement = (e: number): GeckoStyle => e < 0 ? blockStyle : (elements[e] as Extract<GeckoElement, { kind: 'span' }>).style
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
      const style = runStyles[f.run]!
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
        breaker.appendText(langs[f.run]!, tUnits.subarray(f.tStart, f.tEnd), !b.is8bit, flags, sink)
      }
    }
  }

  // 6. Spacing after each character (GetSpacingInternal, nsTextFrame.cpp:4089-4295, letter-spacing model 0).
  const runOfT = new Int32Array(T)
  const frameStartOfT = new Int32Array(T)
  for (let k = 0; k < frames.length; k++) {
    for (let t = frames[k]!.tStart; t < frames[k]!.tEnd; t++) {
      runOfT[t] = frames[k]!.run
      frameStartOfT[t] = frames[k]!.tStart
    }
  }
  const spacingPrefix = new Int32Array(T + 1)
  const scanSpacingPrefix = new Int32Array(T + 1)
  // CalcTabWidths asks GetSpacingInternal for one character at a time (nsTextFrame.cpp:4345-4347), and the base search goes
  // no further back than the range asked for (:4203-4213), so there the base is the character itself: a mark after a cursive
  // letter, script Inherited, takes the letter spacing its cluster doesn't, and so does the low surrogate of a cursive letter
  // (ScalarValueAt gives 0 there, CharacterDataBuffer.h:295-311). Only tab positions read it (lines.ts computeTabs).
  let anyTab = false
  for (let r = 0; r < builds.length; r++) anyTab ||= builds[r]!.hasTab
  const tabSpacingPrefix = anyTab ? new Int32Array(T + 1) : null
  for (let r = 0; r < builds.length; r++) {
    const b = builds[r]!
    for (let t = b.tStart; t < b.tEnd; t++) {
      const run = runOfT[t]!
      const style = runStyles[run]!
      let spacing = 0
      let scanSpacing = 0
      let tabSpacing = 0
      const ls = letterSpacingAu[run]!
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
          while (base > frameStartOfT[t]! && g.clusterStart[base] === 0 && tSource[base]! - 1 === tSource[base - 1]!) base--
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
            const font = runTextStyles[run]!.font
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
              gaps.push({ gap: 'font-fallback', run, detail: `a cursive cluster takes letter spacing where another font draws one of its marks than the character before it (gfxTextRun.cpp:809-829), and the font facts don't say which fonts draw U+${cp.toString(16).toUpperCase()} and its marks`, at: { start: tSource[base]!, end: tSource[t]! + 1 } })
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
      const ws = wordSpacingAu[run]!
      if (ws !== 0) {
        // IsCSSWordSpacingSpace on the original character (nsTextFrame.cpp:880-898).
        const s = tSource[t]!
        const ch = text.charCodeAt(s)
        const f = frames[frameOfSource(frames, s)]!
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
  for (let r = 0; r < builds.length; r++) {
    const b = builds[r]!
    const firstRun = frames[b.flows[0]!.frame]!.run
    const font = runTextStyles[firstRun]!.font
    const lang = langs[firstRun]!
    // The source range of the text run's characters: the text whose widths a condition of the run concerns (DESIGN.md §2.8).
    const at = b.tEnd > b.tStart ? { start: tSource[b.tStart]!, end: tSource[b.tEnd - 1]! + 1 } : { start: frames[b.flows[0]!.frame]!.start, end: frames[b.flows[0]!.frame]!.start }
    const domAu = lroundf(f32(quantize10(font.size) * 60))
    // The DOM shapes at the device font size, the nsFont size in au over the page's apd (nsFontMetrics.cpp:124-134), and
    // rounds every glyph to the page's app units (gfxHarfBuzzShaper.cpp:1559, :1699-1702). A canvas element does the same
    // with its own font size: SetFontInternal takes the size over the CSS-to-device scale, quantized to 7 bits, to the pres
    // context's font cache, the DOM's own (CanvasRenderingContext2D.cpp:4256-4269, :4353), and its text run has the pres
    // context's apd (:7132-7155). So a detached canvas element whose font size is the DOM's device size gives the DOM's
    // advances: width × apd. Probe gecko-port F13 (.artifacts/probes/gecko/round3): equal to the DOM's node width on 243 of
    // 243 units, among them the units an OffscreenCanvas at the CSS size gets 1 au off (`modern` in 15px "Helvetica Neue":
    // DOM and element 3118 au, OffscreenCanvas 3119, where `n` after the kern split is 508.5 au and the 16.16 kern rounds
    // apart at the two scales), system-ui's optical sizing (16px `workers` 3430 au against 3038) and Apple Color Emoji's
    // bitmap sizes; F14: equal on 126 of 126 rows with synthetic bold, whose offset isn't linear in the device size
    // (gfxFont.h:1899-1904). An OffscreenCanvas has apd 60 and its own font group at the CSS size (:4423-4492, :7135-7140).
    const elementCanvas = env.canvasElement === true
    const devSize = domAu / apd
    const canvasSize = elementCanvas ? devSize : font.size
    // The size Canvas takes to the font cache, in au: 7 bits of the canvas size, which an element canvas first divides by
    // the CSS-to-device scale, a float (:4263-4269).
    const canvasAuSize = elementCanvas
      ? lroundf(f32(quantize7(f32(quantize10(devSize) * f32(1 / f32(60 / apd)))) * 60))
      : quantize7(font.size) * 60
    if (canvasAuSize !== domAu) {
      gaps.push({ gap: 'font-size-quantization', run: firstRun, detail: `DOM size ${domAu / 60}px, Canvas size ${canvasAuSize / 60}px`, at })
    }
    // No OffscreenCanvas setting gives the DOM's auto optical sizing (specs/gecko-canvas.md §1.2 C1a), so there a font with
    // an opsz axis, or one whose axis isn't known, may measure differently (DESIGN.md §1.2). A canvas element's font group
    // is the DOM's, optical size included (probe gecko-port F13: system-ui and -apple-system, 22 of 22 units).
    if (!elementCanvas && font.facts.opticalSizeAxis !== false) {
      gaps.push({ gap: 'optical-size', run: firstRun, detail: font.facts.opticalSizeAxis === true ? `${font.family} has an opsz axis` : `whether ${font.family} has an opsz axis isn't given (default ${opticalSizeAxisOf(font)})`, at })
    }
    // An explicit ctx.lang: OffscreenCanvas would otherwise take the root element's lang (CanvasRenderingContext2D.cpp:5446-5465).
    // Content with lang="" matches fonts under the locale language (nsFontCache.cpp:61-63).
    const canvasLang = lang === '' && env.regionalPrefsLocale !== null ? env.regionalPrefsLocale : lang
    const settings = {
      font: canvasFont(font, canvasSize), lang: canvasLang, letterSpacing: letterSpacingAu[firstRun] !== 0 ? '0.001px' : '0px',
      wordSpacing: '0px', fontKerning: 'auto' as const, textRendering: 'auto' as const,
      direction: (b.level & 1) === 1 ? 'rtl' as const : 'ltr' as const, partition: '', element: elementCanvas,
    }
    const context = measureContext(measurer, settings)
    // A Canvas total is its text runs' au over the context's apd (CanvasRenderingContext2D.cpp:5277).
    const auPerPx = elementCanvas ? apd : 60
    const auIn = (ctx: number, s: string) => Math.round(measureText(measurer, ctx, s) * auPerPx)
    const au = (s: string) => auIn(context, s)
    let advance = 0
    const run = { context, scriptRuns: textRunScripts(tUnits, b.tStart, b.tEnd, b.is8bit), tStart: b.tStart, auPerPx }
    // gfxFontGroup::InitTextRun shapes each script run on its own (gfxTextRun.cpp:2779-2809), so no shaped word crosses a
    // script run limit.
    const scriptLimits = new Set<number>()
    for (let k = 0; k < run.scriptRuns.length; k++) scriptLimits.add(run.scriptRuns[k]!.limit)
    // Whether a space takes part in shaping (gfxFont::SpaceMayParticipateInShaping: the DOM then shapes the text without
    // the word cache, across its spaces, gfxFont.cpp:3779-3800) shows where words and spaces measured together differ from
    // the sum of their units. A window of units is tested whole. measureText returns float(au) / 60 as a float
    // (CanvasRenderingContext2D.cpp:5277), which gives the app units back only below 2^18 px: from there a float32 step is
    // 1/32 px or more, up to 0.94 au of rounding. So a window ends before its sum reaches that, and the next one starts at
    // the word before, so every space is tested between its two words.
    let stretchStart = b.tStart
    let stretchWords = 0
    let stretchSpaces = 0
    let stretchSum = 0
    let lastWordStart = b.tStart
    let lastWordSum = 0
    let spacesSinceWord = 0
    const testStretch = (end: number): void => {
      if (stretchWords >= 2 && stretchSpaces >= 1 && stretchSum < CANVAS_EXACT_PX * auPerPx) {
        let s = ''
        for (let t = stretchStart; t < end; t++) s += String.fromCharCode(tUnits[t]!)
        if (au(s) !== stretchSum) {
          gaps.push({ gap: 'space-in-shaping', run: firstRun, detail: `the whole range measures ${au(s)} au, its units ${stretchSum} au`, at: { start: tSource[stretchStart]!, end: tSource[end - 1]! + 1 } })
        }
      }
    }
    const endStretch = (end: number): void => {
      testStretch(end)
      stretchWords = 0
      stretchSpaces = 0
      stretchSum = 0
      lastWordSum = 0
    }
    for (let t = b.tStart; t < b.tEnd;) {
      const ch = tUnits[t]!
      const next = t + 1 < b.tEnd ? tUnits[t + 1]! : 0x0a
      const boundary = (ch === 0x20 || ch === 0xa0) && (b.is8bit || !isClusterExtender(next))
      const invalid = !boundary && (b.is8bit ? isInvalidChar8(ch) : isInvalidChar16(ch))
      let unit: GeckoUnit
      if (boundary) {
        let w = au(ch === 0x20 ? ' ' : ' ')
        // A character after U+200D takes the font of the character before it where that font has it (FindFontForChar,
        // gfxTextRun.cpp:3319-3325), and a boundary space is the space glyph of its own font run (gfxTextRun.cpp:1590-1622).
        // So after a word that ends in U+200D the space is the word's last font's: the word with the space after it, less
        // the word (fresh c-9d8986212ef18179: after Hebrew and U+200D in 18px Georgia the space is 270 au, the fallback
        // font's, where Georgia's is 261 au).
        const last = units.length > 0 ? units[units.length - 1]! : null
        if (last !== null && last.kind === 'word' && last.tEnd === t && tUnits[t - 1] === 0x200d) {
          w = rangeAu(measurer, run, tUnits, last.tStart, t + 1) - last.canvasAu
        }
        unit = { kind: ch === 0x20 ? 'space' : 'nbsp', tStart: t, tEnd: t + 1, canvasAu: w, au: w, startAdvance: advance }
        stretchSpaces++
        stretchSum += w
        lastWordSum += w
        spacesSinceWord++
      } else if (invalid) {
        endStretch(t)
        stretchStart = t + 1
        unit = { kind: 'invalid', tStart: t, tEnd: t + 1, canvasAu: 0, au: 0, startAdvance: advance }
      } else {
        let e = t + 1
        for (; e < b.tEnd; e++) {
          if (scriptLimits.has(e)) break
          const c = tUnits[e]!
          const nx = e + 1 < b.tEnd ? tUnits[e + 1]! : 0x0a
          if (((c === 0x20 || c === 0xa0) && (b.is8bit || !isClusterExtender(nx))) || (b.is8bit ? isInvalidChar8(c) : isInvalidChar16(c))) break
        }
        const w = rangeAu(measurer, run, tUnits, t, e)
        if (letterSpacingAu[firstRun] !== 0) {
          // CanAddSpacingAfter adds letter spacing only before a character that starts a cluster and a ligature group
          // (nsTextFrame.cpp:3860-3873), and the spacing above counts clusters. Letter spacing turns optional ligatures off;
          // the groups required shaping still forms show in Canvas's own letter spacing, which goes by the same two flags
          // (CanvasRenderingContext2D.cpp:4759-4790): W at 2px less W at 0.001px, over 2px, counts the unit's groups (probe
          // gecko-port F17). A unit with as many groups as clusters is spaced as the DOM spaces it. With fewer, Canvas
          // doesn't say which cluster lost its spacing, unless the unit's script is cursive and takes none (:4107-4133).
          let clusters = 0
          let spaced = false
          for (let k = t; k < e; k++) {
            clusters += g.clusterStart[k]!
            if (spacingPrefix[k + 1] !== spacingPrefix[k]) spaced = true
          }
          if (spaced) {
            const wide = rangeAu(measurer, { ...run, context: measureContext(measurer, { ...settings, letterSpacing: '2px' }) }, tUnits, t, e)
            const groups = (wide - w) / (2 * auPerPx)
            if (groups !== clusters) {
              gaps.push({ gap: 'glyph-clusters', run: firstRun, detail: `Canvas letter spacing counts ${groups} ligature groups in a unit of ${clusters} clusters, and the DOM spaces by ligature group starts (nsTextFrame.cpp:3860-3873)`, at: { start: tSource[t]!, end: tSource[e - 1]! + 1 } })
            }
          }
        }
        let total = w
        if (elementCanvas) {
          // Nothing to correct: the context's advances are the DOM's. What stays is time. Outside the listed fonts, which
          // font draws a character with the Emoji property follows font matching's state: the preferred-font cache answers
          // for a language group without looking at the presentation asked for (gfxFontGroup::WhichPrefFontSupportsChar,
          // gfxTextRun.cpp:4003-4005, :4038-4040, :4083-4086), the previous character's font is tried before system fallback
          // (:3559-3569), a color font found on the way is kept as the candidate where no text font turns up (:3385-3390),
          // and system fallback sees the fonts whose character maps are loaded by then. The font group is the DOM's own, and
          // every lookup since the DOM's layout, this port's included, moved that state (probes gecko-port F2, F3: after one
          // U+1F600 U+FE0E, Canvas and the DOM both draw U+1F600 with a text font; fresh c-a2ed29d78da443cd: U+1F3F3 at the
          // end of a text run is 960 au natively, Apple Color Emoji's, and 1020 au in Canvas afterwards; held-out
          // c-6403c221b98778d6: U+1F600 U+FE0E is Apple Color Emoji's 1440 au natively and 1020 au in Canvas). Canvas shows
          // where it can matter: the cluster doesn't measure as in "Apple Color Emoji" alone, in width or ink box (F11), so
          // two fonts can draw it. The port never adds U+FE0E to a string: asking for text presentation is what pins a text
          // font for the document's later text (F2). Basic Latin and Latin-1 never get that far: the preferred fonts of
          // their language group, which come before the previous font and system fallback, cover them (:3533-3552;
          // GetFontPrefLangFor, gfxPlatformFontList.cpp:2448-2461).
          if (!b.is8bit) {
            let word = ''
            for (let k = t; k < e; k++) word += String.fromCharCode(tUnits[k]!)
            const boundaries = graphemeBoundaries(word, graphemeRules)
            for (let c = 0; c + 1 < boundaries.length; c++) {
              const cluster = word.slice(boundaries[c]!, boundaries[c + 1]!)
              const first = cluster.codePointAt(0)!
              if (first < 0x100 || emojiPresentation(first) === 'text-only') continue
              const emojiContext = measureContext(measurer, { ...settings, font: canvasFont({ ...font, family: COLOR_EMOJI_FAMILY }, canvasSize) })
              const here = measureTextBounds(measurer, context, cluster)
              const there = measureTextBounds(measurer, emojiContext, cluster)
              if (here.width !== there.width || here.left !== there.left || here.right !== there.right) {
                gaps.push({ gap: 'page-history', run: firstRun, detail: `U+${first.toString(16).toUpperCase()} measures ${Math.round(here.width * auPerPx)} au here and ${Math.round(there.width * auPerPx)} au in "Apple Color Emoji" alone: outside the listed fonts, which of the two fonts draws it follows font matching's state at the DOM's layout time (gfxTextRun.cpp:4003-4005, :3559-3569; probes gecko-port F2, F3)`, at: { start: tSource[t + boundaries[c]!]!, end: tSource[t + boundaries[c + 1]! - 1]! + 1 } })
              }
            }
          }
        } else if (!b.is8bit) {
          // Apple Color Emoji is an sbix font: the DOM takes its advances from Core Text at the device size, Canvas at the
          // CSS size (gfxMacFont.cpp:437-463; specs/gecko-canvas.md §1.9, §2 A12). Which font draws a cluster is font
          // matching's decision (gfxFontGroup::FindFontForChar, gfxTextRun.cpp:3178-3600), and the document's fallback
          // history changes it: after one U+1F600 U+FE0E, Canvas and the DOM both draw U+1F600 with a text font (probes
          // gecko-port F2, F3). Canvas shows which: Apple Color Emoji draws the cluster when it measures the same in the
          // run's font list as in "Apple Color Emoji" alone, at the CSS size and at the device size (F3, 16px Arial:
          // fresh 1260 and 1920 au in both; pinned 1020 au in Arial and 1260 au in Apple Color Emoji, DOM 1020 au).
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
            // The ink box too: a text font whose widths happen to equal Apple Color Emoji's at both sizes still draws another
            // glyph. Probe gecko-port F11 (.artifacts/probes/gecko/round2b): U+1F600 in Arial, Menlo, "Apple Symbols" and
            // "Times New Roman" measures as in "Apple Color Emoji" alone, box [60, 1020] au, and U+263A in Arial doesn't (980 au,
            // box [−131.25, 848.91]).
            const sameBox = (a: { left: number; right: number }, b: { left: number; right: number }) => a.left === b.left && a.right === b.right
            const inEmojiFont = atCssSize === auIn(emojiFontContext(font.size), cluster) &&
              auIn(deviceContext, cluster) === auIn(emojiFontContext(devSize), cluster) &&
              sameBox(measureTextBounds(measurer, context, cluster), measureTextBounds(measurer, emojiFontContext(font.size), cluster))
            const clusterAt = { start: tSource[t + boundaries[c]!]!, end: tSource[t + boundaries[c + 1]! - 1]! + 1 }
            const next = cluster.codePointAt(first >= 0x10000 ? 2 : 1) ?? 0
            // An emoji-default character with U+FE0E asks for a glyph without color (TextExplicit, gfxTextRun.cpp:3268-3273).
            // The preferred fonts and the common fallback list of its script hold none for it (gfxPlatformMac.cpp:147-262
            // puts "Apple Color Emoji" first only for a color request), so the font comes from the system-wide search, which
            // in a content process looks only at the families whose character maps are loaded by then and starts loading the
            // others (GlobalFontFallback, gfxPlatformFontList.cpp:1474-1486), and a color font found on the way stays the
            // candidate where the search finds nothing (:1290-1300; gfxTextRun.cpp:3385-3390). So which font draws it follows
            // the process's history, unless a listed family draws it. Both orders of the development and held-out suite
            // samples (round 4, `.artifacts/lab/gecko/r4-1`): `❤️😀︎❤️` gives U+1F600 U+FE0E 20.7px natively after one
            // history and 33.5px after the other, in 5 of the 5 history-dependent cases round 2's condition didn't name.
            if (next === 0xfe0e && presentation === 'emoji-default') {
              const listed = listedFontOf(font, first)
              if (listed === null || listed < 0) {
                gaps.push({ gap: 'page-history', run: firstRun, detail: `U+${first.toString(16).toUpperCase()} U+FE0E asks for a glyph without color, which only the system-wide font search finds, among the families whose character maps the process has loaded by then (gfxPlatformFontList.cpp:1474-1486)`, at: clusterAt })
              }
            }
            if (!inEmojiFont) {
              if (prefersColorGlyph(presentation, first, next)) {
                gaps.push({ gap: 'page-history', run: firstRun, detail: `U+${first.toString(16).toUpperCase()} asks for a color glyph, but Canvas draws it with another font than Apple Color Emoji (${atCssSize} au): the document's font fallback has pinned it, and the DOM follows the state at its own layout time (probes gecko-port F2, F3)`, at: clusterAt })
              }
              continue
            }
            // A cluster that doesn't ask for a color glyph makes FindFontForChar look for a font without one first
            // (gfxTextRun.cpp:3268-3308). Canvas runs the same matching in both contexts, except where the run's font string is
            // Apple Color Emoji's own: then the two contexts are one and the test above can't fail. Probe gecko-port F4: `©︎`
            // in 16px "Apple Color Emoji" draws with a text font at 729 au in Canvas and the DOM.
            if (settings.font === canvasFont({ ...font, family: COLOR_EMOJI_FAMILY }, font.size) &&
              !prefersColorGlyph(presentation, first, cluster.codePointAt(first >= 0x10000 ? 2 : 1) ?? 0)) {
              gaps.push({ gap: 'font-fallback', run: firstRun, detail: `U+${first.toString(16).toUpperCase()} asks for text presentation in Apple Color Emoji's own font list: which font the DOM draws it with depends on text fonts' coverage, which the Canvas test can't show there (gfxTextRun.cpp:3268-3308)`, at: clusterAt })
            }
            if (apd !== 60 && quantize7(devSize) !== devSize) {
              gaps.push({ gap: 'bitmap-emoji-size', run: firstRun, detail: `device size ${devSize}px is not on Canvas's 7-bit size grid`, at: clusterAt })
            }
            // The DOM stores floor(apd × device advance + 0.5) (gfxHarfBuzzShaper.cpp:1559); a lone regional indicator's
            // advance isn't a whole pixel (28.683px at 28px), so round once from the Canvas au at the device size.
            const deviceAu60 = auIn(deviceContext, cluster)
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
              const regularAu60 = auIn(measureContext(measurer, { ...settings, font: canvasFont({ ...font, weight: 400 }, devSize) }), cluster)
              const canvasStep = Math.floor(syntheticBoldOffset(quantize7(devSize)) * 60 + 0.5)
              const steps = (deviceAu60 - regularAu60) / canvasStep
              if (font.weight !== 400 && Number.isInteger(steps) && steps >= 1 && (regularAu60 * apd) % 60 === 0) {
                dom = regularAu60 * apd / 60 + steps * Math.floor(syntheticBoldOffset(devSize) * apd + 0.5)
              } else {
                gaps.push({ gap: 'bitmap-emoji-size', run: firstRun, detail: `device-size advance ${deviceAu60} au at apd 60 doesn't give an exact au at apd ${apd}`, at: clusterAt })
              }
            }
            const delta = dom - atCssSize
            correction[t + boundaries[c]!] = delta
            total += delta
          }
        }
        unit = { kind: 'word', tStart: t, tEnd: e, canvasAu: w, au: total, startAdvance: advance }
        if (w >= CANVAS_EXACT_PX * auPerPx) {
          gaps.push({ gap: 'float32-precision', run: firstRun, detail: `a shaping unit ${w} au wide: measureText's float width gives app units back only below 2^18 px (CanvasRenderingContext2D.cpp:5277)`, at: { start: tSource[t]!, end: tSource[e - 1]! + 1 } })
        }
        if (stretchSum + w >= CANVAS_EXACT_PX * auPerPx && stretchWords >= 1) {
          testStretch(t)
          stretchStart = lastWordStart
          stretchWords = 1
          stretchSpaces = spacesSinceWord
          stretchSum = lastWordSum
        }
        stretchWords++
        stretchSum += w
        lastWordStart = t
        lastWordSum = w
        spacesSinceWord = 0
      }
      for (let k = unit.tStart; k < unit.tEnd; k++) unitOf[k] = units.length
      units.push(unit)
      advance += unit.au
      t = unit.tEnd
    }
    endStretch(b.tEnd)
    textRuns.push({
      tStart: b.tStart, tEnd: b.tEnd, is8bit: b.is8bit, level: b.level, context, font, scriptRuns: run.scriptRuns, hasShy: b.hasShy,
      trailingBreak: b.trailingBreak, minTabAdvance: b.hasTab ? 0.5 * au('0') : 0,
      hyphenAu: b.hasShy ? au('‐') : 0, hasTab: b.hasTab, totalAdvance: advance, pairKerning: font.facts.pairKerning, scriptLookups: firstFontScriptLookups(font), joining: font.facts.joining, auPerPx,
      advancesStandIn: canvasAuSize !== domAu ? 'font-size-quantization' : !elementCanvas && font.facts.opticalSizeAxis !== false ? 'optical-size' : null,
    })
  }
  const correctionPrefix = new Int32Array(T + 1)
  for (let t = 0; t < T; t++) correctionPrefix[t + 1] = correctionPrefix[t]! + correction[t]!

  // ComputeTabWidthAppUnits (nsTextFrame.cpp:3875-3906) reads the space, the letter spacing and the word spacing from the
  // containing block, and tab-size from the text frame (lines.ts computeTabs).
  let tabUnit = 0
  for (let r = 0; r < textRuns.length; r++) {
    if (!textRuns[r]!.hasTab) continue
    // The block's space on the run's kind of canvas: a canvas element at the block font's device size, else an
    // OffscreenCanvas at its CSS size.
    const elementCanvas = env.canvasElement === true
    const context = measureContext(measurer, {
      font: canvasFont(paragraph.font, elementCanvas ? lroundf(f32(quantize10(paragraph.font.size) * 60)) / apd : paragraph.font.size), lang: paragraph.lang,
      letterSpacing: pxToAu(paragraph.letterSpacing) !== 0 ? '0.001px' : '0px', wordSpacing: '0px', fontKerning: 'auto',
      textRendering: 'auto', direction: 'ltr', partition: '', element: elementCanvas,
    })
    const space = Math.round(measureText(measurer, context, ' ') * (elementCanvas ? apd : 60))
    tabUnit = space + pxToAu(paragraph.letterSpacing) + pxToAu(paragraph.wordSpacing)
    break
  }

  // Text of a language ICU4X breaks with its LSTM models (complex/language.rs:17-45, linebreak.ts segmentComplex).
  switch (env.dictionaryBreaks.kind) {
    case 'intl-segmenter-word':
      break
    case 'unavailable': {
      // Each stretch of such text: the break opportunities inside it are unknown.
      for (let s = 0; s < n;) {
        if (complexLanguage(text.charCodeAt(s)) === '') { s++; continue }
        let e = s + 1
        while (e < n && complexLanguage(text.charCodeAt(e)) !== '') e++
        gaps.push({ gap: 'dictionary-breaks-unavailable', run: null, detail: 'Thai, Lao, Khmer or Myanmar text', at: { start: s, end: e } })
        s = e
      }
      break
    }
  }
  // U+FFFD outside the listed fonts takes the family the process cached the first time system fallback placed one, whatever
  // this run's style and neighbours would choose (gfxPlatformFontList::SystemFindFontForChar,
  // gfxPlatformFontList.cpp:1244-1268, :1328-1330): its width follows the process's history. Canvas reads the same cache, so
  // the prediction follows the state at measuring time. Which fonts cover U+FFFD isn't a Canvas fact, so every U+FFFD reports
  // it unless the coverage facts name a listed family for it (the round 2 held-out suite's 104 history-dependent
  // suite/U+FFFD rows: 16px natively after one history, 13.133px after another).
  for (let s = 0; s < n; s++) {
    if (text.charCodeAt(s) !== 0xfffd) continue
    let run = 0
    while (runStarts[run + 1]! <= s) run++
    // A listed family that the coverage facts say draws U+FFFD keeps it out of system fallback (fonts.ts listedFontOf).
    const listed = listedFontOf(runTextStyles[run]!.font, 0xfffd)
    if (listed !== null && listed >= 0) continue
    gaps.push({ gap: 'page-history', run, detail: 'U+FFFD outside the listed fonts takes the family the process first fell back to for U+FFFD (gfxPlatformFontList.cpp:1244-1268, :1328-1330)', at: { start: s, end: s + 1 } })
  }

  // gfxFont::SynthesizeSpaceWidth gives a U+2007 or U+2008 that no font in the list covers the font's figure or space width,
  // rounded to whole device pixels (gfxTextRun.cpp:3032-3043, gfxFont.cpp:4809-4814). Canvas rounds at apd 60 and shows
  // neither whether a font covers it nor the unrounded width. A canvas element at the device size synthesizes the DOM's width.
  if (apd !== 60 && env.canvasElement !== true) {
    for (let s = 0; s < n; s++) {
      const u = text.charCodeAt(s)
      if (u !== 0x2007 && u !== 0x2008) continue
      let run = 0
      while (runStarts[run + 1]! <= s) run++
      gaps.push({ gap: 'font-fallback', run, detail: `U+${u.toString(16).toUpperCase()} takes a synthesized width rounded to device pixels where no font covers it`, at: { start: s, end: s + 1 } })
    }
  }

  return {
    paragraph, env, appUnitsPerDevPixel: apd, blockStyle, text, runStarts, runStyles, runParents, runLangs: langs, letterSpacingAu, frames, items,
    elements, textRuns, tUnits, tSource, breakFlags: g.breakFlags, clusterStart: g.clusterStart, isSpace: g.isSpace, kind: g.kind,
    spacingPrefix, scanSpacingPrefix, tabSpacingPrefix, correctionPrefix, unitOf, units, sourceT, nextT, tabUnit, emergencyUnconfirmed, textIndentAu: pxToAu(paragraph.textIndent), bidi: resolveBidi, gaps,
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
