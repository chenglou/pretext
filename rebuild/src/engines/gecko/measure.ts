// What the Gecko port asks Canvas for a range of transformed text (Firefox 156.0): the contexts text runs measure in, the
// script runs gfxFontGroup::InitTextRun shapes, the script context a piece of a shaping unit needs, and rangeAu, the one
// recipe every unit, prefix and suffix goes through. specs/gecko-canvas.md §2-§3.
import { contextFor, width, type CanvasSettings, type Context, type ContextPool } from '../../measure/canvas.js'
import { AL, R, bidiClassOf } from '../../unicode/bidi.js'
import { geckoBidiData } from './data.js'
import { hasScript, isBidiControl, isBidiMirrored, isClosePunctuation, isClusterExtender, isOpenPunctuation, openingMirror, scriptOf } from './props.js'
import type { GeckoTextRun, RunContexts, ScriptRun } from './types.js'

// A Canvas total is its text runs' au over the context's 60 app units per px (CanvasRenderingContext2D.cpp:5277, :7135-7140).
export const CANVAS_AU_PER_PX = 60

// CanvasRenderingContext2D QuantizeFontSize, 7 significant bits (CanvasRenderingContext2D.cpp:4207-4217).
export function quantize7(size: number): number {
  const f32 = Math.fround
  const d = f32(size * 131073)
  const t = f32(d - size)
  return f32(d - t)
}

// One record of recipe contexts per canonical context (types.ts RunContexts). Text runs that measure alike share it.
export function runContextsFor(records: Map<Context, RunContexts>, contexts: ContextPool, settings: CanvasSettings): RunContexts {
  const own = contextFor(contexts, settings)
  const found = records.get(own)
  if (found !== undefined) return found
  const made: RunContexts = { own, noLigatures: null, letterSpaced: null, large: null, pairPlacement: null }
  records.set(own, made)
  return made
}

// A run's context with letter spacing 0.001px, and with 2px: found in the paragraph's list or made at its end where a recipe
// first asks, and read from the record from then on.
export function noLigaturesContext(contexts: ContextPool, run: RunContexts): Context {
  return run.noLigatures ??= contextFor(contexts, { ...run.own.settings, letterSpacing: '0.001px' })
}

export function letterSpacedContext(contexts: ContextPool, run: RunContexts): Context {
  return run.letterSpaced ??= contextFor(contexts, { ...run.own.settings, letterSpacing: '2px' })
}

export const isSurrogatePair = (a: number, b: number) => (a & 0xfc00) === 0xd800 && (b & 0xfc00) === 0xdc00
export const combine = (a: number, b: number) => 0x10000 + ((a - 0xd800) << 10) + (b - 0xdc00)

// gfxFontGroup::IsInvalidChar (gfxTextRun.h:971-992).
export function isInvalidChar16(ch: number): boolean {
  if (ch >= 0x20 && ch < 0x7f) return false
  if (ch <= 0x9f) return true
  return ((ch & 0xff00) === 0x2000 && (ch === 0x200b || ch === 0x2028 || ch === 0x2029 || ch === 0x2060)) ||
    ch === 0xfeff || isBidiControl(ch)
}
export const isInvalidChar8 = (ch: number) => (ch & 0x7f) < 0x20 || ch === 0x7f

// A script that merges into the run around it: Common, Inherited, Unknown.
export const NO_SCRIPT_GAPS = new Int32Array(0)
const isCommonScript = (s: string) => s === 'Zyyy' || s === 'Zinh' || s === 'Zzzz'
// Latin below U+02EA (gfxScriptItemizer.h:96-107).
const fastLatin = (ch: number) => ((ch & ~0x20) >= 0x41 && (ch & ~0x20) <= 0x5a) || (ch >= 0xc0 && ch <= 0xd6) ||
  (ch >= 0xd8 && ch <= 0xf6) || (ch >= 0xf8 && ch <= 0x2b8) || (ch & ~0x10) === 0xaa || (ch >= 0x2e0 && ch <= 0x2e4)

// gfxScriptItemizer (gfxScriptItemizer.cpp:60-243), run boundaries only.
const PAREN_STACK_DEPTH = 32
export function scriptRunLimits(units: Uint16Array, start: number, end: number): ScriptRun[] {
  const limits: ScriptRun[] = []
  const parenChar = new Int32Array(PAREN_STACK_DEPTH)
  const parenScript: string[] = new Array<string>(PAREN_STACK_DEPTH).fill('Zyyy')
  let parenSp = -1
  let pushCount = 0
  let fixupCount = 0
  let scriptLimit = start
  while (scriptLimit < end) {
    fixupCount = 0
    let scriptCode = 'Zyyy'
    while (scriptLimit < end) {
      const startOfChar = scriptLimit
      let ch = units[scriptLimit]!
      let sc: string
      if (ch < 0x02ea) {
        sc = fastLatin(ch) ? 'Latn' : 'Zyyy'
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
      const same = isCommonScript(scriptCode) || isCommonScript(sc) || sc === scriptCode || isClusterExtender(ch) || hasScript(ch, scriptCode)
      if (same) {
        if (scriptCode === 'Zyyy' && !isCommonScript(sc)) {
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
    limits.push({ limit: scriptLimit, script: scriptCode, contextGaps: NO_SCRIPT_GAPS })
  }
  return limits
}

// The script runs gfxFontGroup::InitTextRun shapes [start, end) with (gfxTextRun.cpp:2729-2757): text with every code
// unit below U+02EA is one run, Latin when it has a Latin letter, else Common resolved from the language; other text goes
// through the itemizer. Common stays Common here, standing for "resolved from the language". An 8-bit text run tests
// `const uint8_t c = aString[j] & ~0x20; hasLetter = (c - 'A' <= 'Z' - 'A')` (:2744-2747): `c - 'A'` is a signed int, so
// every unit whose masked value is at most 'Z' counts, digits, spaces and ASCII punctuation included. Probe gecko-port F8
// (.artifacts/probes/gecko/round2): ` 7:00-9:00` in 18px bold "Apple SD Gothic Neo" under lang="ko" kerns `7:` and `-9` as
// an 8-bit node (5184 au) and doesn't within a 16-bit text run (4969 au), where Common resolves to Hangul and CJK scripts
// turn kerning off (gfxHarfBuzzShaper.cpp:1405-1438).
export function textRunScripts(units: Uint16Array, start: number, end: number, is8bit: boolean): ScriptRun[] {
  let allCommonOrLatin = true
  for (let i = start; i < end; i++) if (units[i]! >= 0x02ea) { allCommonOrLatin = false; break }
  if (!allCommonOrLatin) return scriptRunLimits(units, start, end)
  let hasLetter = false
  for (let i = start; i < end && !hasLetter; i++) {
    const u = units[i]!
    hasLetter = is8bit ? (u & 0xdf) <= 0x5a : fastLatin(u)
  }
  return [{ limit: end, script: hasLetter ? 'Latn' : 'Zyyy', contextGaps: NO_SCRIPT_GAPS }]
}

// The script of the character at `i` of units read up to `end`: a surrogate pair that `end` cuts is a lone surrogate, as
// it is to the itemizer (scriptRunLimits).
export function scriptAt(units: Uint16Array, i: number, end: number): string {
  const u = units[i]!
  if (u < 0x02ea) return fastLatin(u) ? 'Latn' : 'Zyyy'
  return scriptOf(i + 1 < end && isSurrogatePair(u, units[i + 1]!) ? combine(u, units[i + 1]!) : u)
}

// The itemizer's ordered limits: the first script run whose exclusive end is after t.
export function scriptRunIndex(runs: readonly ScriptRun[], t: number): number {
  let lo = 0, hi = runs.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (runs[mid]!.limit <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

// The first nonmatching-script interval whose exclusive end follows t.
function contextGapAfter(gaps: Int32Array, t: number): number {
  let lo = 0, hi = gaps.length / 2
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (gaps[mid * 2 + 1]! <= t) lo = mid + 1
    else hi = mid
  }
  return lo * 2
}

// The script context a piece [tStart, tEnd) of a word unit needs: the DOM itemizer merges Common characters into the
// script run around them (gfxScriptItemizer.cpp:60-243), and HarfBuzz shapes with that run's script (CJK runs without
// kern, gfxHarfBuzzShaper.cpp:1405-1438). When the piece measured alone itemizes to another script, a character of the
// DOM's script from the same script run, before or after the piece, gives Canvas that script.
function scriptContextFor(units: Uint16Array, runs: ScriptRun[], runStart: number, tStart: number, tEnd: number):
  { text: string; before: boolean } | null {
  const k = scriptRunIndex(runs, tStart)
  const from = k === 0 ? runStart : runs[k - 1]!.limit
  const domScript = runs[k]!.script
  if (isCommonScript(domScript)) return null
  // Canvas builds its text run from a 16-bit string (CanvasRenderingContext2D.cpp:4822-4851), whose first script run takes
  // the script of the piece's first character that has one: Common characters before it join its run, and a bracket
  // takes a script only from a run that has one (scriptRunLimits). The itemizer reads Hiragana as Katakana, so a run's
  // script is never 'Hira', and a Hiragana piece in a 'Kana' run itemizes alone to the run's script.
  let alone = 'Zyyy'
  for (let i = tStart; i < tEnd && isCommonScript(alone); i++) alone = scriptAt(units, i, tEnd)
  if (alone === domScript || (alone === 'Hira' && domScript === 'Kana')) return null
  const limit = runs[k]!.limit
  const gaps = runs[k]!.contextGaps
  let previous = tStart - 1
  if (previous >= from && scriptAt(units, previous, units.length) !== domScript) previous = gaps[contextGapAfter(gaps, previous)]! - 1
  if (previous >= from) {
    const u = units[previous]!
    if ((u & 0xfc00) === 0xdc00 && previous > from) return { text: String.fromCharCode(units[previous - 1]!, u), before: true }
    return { text: String.fromCharCode(u), before: true }
  }
  let next = tEnd
  if (next < limit && scriptAt(units, next, units.length) !== domScript) next = gaps[contextGapAfter(gaps, next) + 1]!
  if (next < limit) {
    const u = units[next]!
    if (isSurrogatePair(u, units[next + 1] ?? 0)) return { text: String.fromCharCode(u, units[next + 1]!), before: false }
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
// `before` and `after` are put around the piece: U+200D where the piece is cut between joined letters (advance.ts).
// The Canvas context is the text run's own, or another of its record: another letter spacing, a larger size
// (types.ts RunContexts).
export function rangeAu(context: Context, run: Pick<GeckoTextRun, 'scriptRuns' | 'tStart'>, units: Uint16Array,
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
  if (context.settings.direction === 'rtl' && (piece.length === 1 || (piece.length === 2 && isSurrogatePair(piece.charCodeAt(0), piece.charCodeAt(1))))) {
    const cp = piece.codePointAt(0)!
    const bidiClass = bidiClassOf(geckoBidiData, cp)
    if (bidiClass !== R && bidiClass !== AL && isBidiMirrored(cp)) piece += '\u200c'
  }
  const w = (s: string) => Math.round(width(context, s) * CANVAS_AU_PER_PX)
  // gfxFontGroup::ComputeRanges matches fonts over the whole script run, carrying the previous character and its matched font
  // (gfxTextRun.cpp:3593-3875), and FindFontForChar reads them for a cluster extender and U+202F (:3181-3212). A piece that
  // starts with one right after an invalid character begins a shaping unit, so the text before it shapes apart
  // (gfxFont.cpp:3872-3897), and Canvas reproduces the DOM's advances with the script run's earlier text in front. Probe
  // gecko-port F4 (.artifacts/probes/gecko/font-matching): `a WJ U+0301 ZWSP U+0308 U+093E b` in 16px Arial is 1329 au whole
  // as in the DOM, where `U+0308 U+093E b` alone and after ZWSP measure 1429 au; `x U+2028 U+202F` gives U+202F 0 au whole
  // as in the DOM and 192 au alone.
  if (tStart > run.tStart && tStart < tEnd && isInvalidChar16(units[tStart - 1]!) && (isClusterExtender(units[tStart]!) || units[tStart] === 0x202f)) {
    const k = scriptRunIndex(run.scriptRuns, tStart)
    const from = k === 0 ? run.tStart : run.scriptRuns[k - 1]!.limit
    let prefix = ''
    for (let k = from; k < tStart; k++) prefix += String.fromCharCode(units[k]!)
    return w(prefix + piece) - w(prefix)
  }
  const script = scriptContextFor(units, run.scriptRuns, run.tStart, tStart, tEnd)
  if (script === null) return w(piece)
  return script.before ? w(script.text + ' ' + piece) - w(script.text + ' ') : w(piece + ' ' + script.text) - w(' ' + script.text)
}
