// Break opportunities as Firefox 156 computes them: nsLineBreaker (dom/base/nsLineBreaker.cpp, byte-identical to 155)
// accumulating words across mapped flows, LineBreaker::ComputeBreakPositions (intl/lwbrk/LineBreaker.cpp:112-194)
// calling ICU4X icu_segmenter 2.1.2's LineBreakIterator per word (third_party/rust/icu_segmenter/src/line.rs), and
// gfxTextRun::SetPotentialLineBreaks (gfxTextRun.cpp:210-236). specs/gecko-text.md §8-§10.
import { geckoLineRules } from '../../breaks/tables.js'
import { BREAK, INTERMEDIATE, KEEP, NO_MATCH, icu4xProperty, type Icu4xRuleData } from '../../breaks/icu4x.js'
import type { GeckoEnvironment } from '../../env.js'
import { scriptIsChineseOrJapanese } from './likely.js'

type DictionaryBreaks = GeckoEnvironment['dictionaryBreaks']

// Line_Break property values of the data (line.rs:20-128).
const AI = 1, AL = 3, BA = 8, BK = 10, CJ = 12, CM = 14, CR = 16, EX = 19, H2 = 21, H3 = 22, HY = 24, ID = 25, IN = 27,
  JL = 29, JT = 30, JV = 31, LF = 32, NL = 33, NS = 34, NU = 35, PO_EAW = 39, PR_EAW = 41, SA = 46, SP = 47, ZW = 53,
  ZWJ = 54

export type Strictness = 'strict' | 'normal' | 'loose' | 'anywhere'
export type WordOption = 'normal' | 'break-all' | 'keep-all'
export type SegmenterOptions = { strictness: Strictness; wordOption: WordOption; jaZh: boolean }

// Break flags on a text run character (nsLineBreaker.h:26-31, gfxFont.h:788).
export const BREAK_NONE = 0
export const BREAK_NORMAL = 1
export const BREAK_EMERGENCY_WRAP = 3

// complex/language.rs:17-45, read on single code units (LanguageIteratorUtf16).
export function complexLanguage(u: number): string {
  if (u >= 0xe01 && u <= 0xe7f) return 'th'
  if (u >= 0xe80 && u <= 0xeff) return 'lo'
  if ((u >= 0x1000 && u <= 0x109f) || (u >= 0xa9e0 && u <= 0xa9ff) || (u >= 0xaa60 && u <= 0xaa7f)) return 'my'
  if ((u >= 0x1780 && u <= 0x17ff) || (u >= 0x19e0 && u <= 0x19ff)) return 'km'
  return ''
}

// complex_language_segment_utf16 (complex/mod.rs:135-156): split the SA run by language and let the LSTM model mark
// boundaries inside each slice; every slice reports its end. Firefox's Intl.Segmenter word granularity runs the same
// ICU4X models (specs/gecko-text.md §10, DESIGN.md §6.3); without it a slice has no interior boundaries.
function segmentComplex(units: number[], dictionary: DictionaryBreaks): number[] {
  const result: number[] = []
  let i = 0
  while (i < units.length) {
    const language = complexLanguage(units[i]!)
    let j = i + 1
    while (j < units.length && complexLanguage(units[j]!) === language) j++
    if (language !== '') {
      switch (dictionary.kind) {
        case 'intl-segmenter-word': {
          let slice = ''
          for (let k = i; k < j; k++) slice += String.fromCharCode(units[k]!)
          const segments = new Intl.Segmenter(language, { granularity: 'word' }).segment(slice)
          for (const part of segments) if (part.index > 0) result.push(i + part.index)
          break
        }
        case 'unavailable':
          break
      }
    }
    result.push(j)
    i = j
  }
  return result
}

// KeepAll pairs (line.rs:901-907).
const keepAllLetter = (p: number) => p === AI || p === AL || p === ID || p === NU || p === HY || p === H2 || p === H3 ||
  p === JL || p === JV || p === JT || p === CJ

// is_break_utf32_by_loose (line.rs:721-780): null, or whether to break.
function looseBreak(rightCp: number, left: number, right: number, jaZh: boolean): boolean | null {
  if (right === BA) {
    if (left === ID && (rightCp === 0x2010 || rightCp === 0x2013)) return true
  } else if (right === NS) {
    if (rightCp === 0x301c || rightCp === 0x30a0) return jaZh
    if (rightCp === 0x3005 || rightCp === 0x303b || rightCp === 0x309d || rightCp === 0x309e || rightCp === 0x30fd ||
      rightCp === 0x30fe) return true
    if (rightCp === 0x30fb || rightCp === 0xff1a || rightCp === 0xff1b || rightCp === 0xff65 || rightCp === 0x203c ||
      (rightCp >= 0x2047 && rightCp <= 0x2049)) return jaZh
  } else if (right === IN) {
    return true
  } else if (right === EX) {
    if (rightCp === 0xff01 || rightCp === 0xff1f) return jaZh
  }
  if (right === PO_EAW) return jaZh
  if (left === PR_EAW) return jaZh
  return null
}

// LineBreakIterator over UTF-16 (line.rs:833-1080, Utf16 handling at :1249-1340). Returns every boundary, including 0
// and text.length.
export function icu4xLineBoundaries(text: string, options: SegmenterOptions, dictionary: DictionaryBreaks): number[] {
  const d: Icu4xRuleData = geckoLineRules()
  const out: number[] = []
  const len = text.length
  let front = 0
  let pos = -1
  let cp = 0
  const advance = (): void => {
    if (front >= len) { pos = -1; return }
    let c = text.charCodeAt(front)
    pos = front
    front++
    if ((c & 0xfc00) === 0xd800 && front < len) {
      const next = text.charCodeAt(front)
      if ((next & 0xfc00) === 0xdc00) { c = ((c & 0x3ff) << 10) + (next & 0x3ff) + 0x10000; front++ }
    }
    cp = c
  }
  // get_linebreak_property_utf32_with_rule (line.rs:677-700).
  const prop = (c: number): number => {
    const p = icu4xProperty(d, c)
    if (p === CJ && (options.wordOption === 'break-all' || options.strictness === 'loose' || options.strictness === 'normal')) return ID
    return p
  }
  const state = (left: number, right: number): number => d.states[left * d.propertyCount + right] ?? KEEP
  let cache: number[] = []

  // check_eof: the first call returns 0 (line.rs:1086-1107).
  advance()
  out.push(0)
  if (pos < 0) return out

  next: for (;;) {
    if (cache.length > 0) { // line.rs:838-852
      const firstPos = cache[0]!
      let i = 0
      for (;;) {
        if (i === firstPos) {
          const rest: number[] = []
          for (let k = 1; k < cache.length; k++) rest.push(cache[k]! - i)
          cache = rest
          out.push(pos)
          continue next
        }
        i += cp >= 0x10000 ? 2 : 1
        advance()
        if (pos < 0) { out.push(len); return out }
      }
    }
    let lb9Left = -1
    let lb8aAfterLb9 = false
    outer: for (;;) {
      const leftCp = cp
      let left = lb9Left >= 0 ? lb9Left : prop(leftCp)
      const afterZwj = lb8aAfterLb9 || (lb9Left < 0 && left === ZWJ)
      advance()
      if (pos < 0) { out.push(len); return out }
      const rightCp = cp
      const right = prop(rightCp)
      // LB9 (line.rs:872-893)
      if ((right === CM || (right === ZWJ && options.strictness !== 'anywhere')) && left !== BK && left !== CR &&
        left !== LF && left !== NL && left !== SP && left !== ZW) {
        lb9Left = left
        lb8aAfterLb9 = right === ZWJ
        continue
      }
      lb9Left = -1
      lb8aAfterLb9 = false
      // CSS word-break (line.rs:895-909)
      if (options.wordOption === 'break-all' && (left === AL || left === NU || left === SA)) left = ID
      else if (options.wordOption === 'keep-all' && keepAllLetter(left) && keepAllLetter(right)) continue
      // CSS line-break (line.rs:911-937)
      switch (options.strictness) {
        case 'normal':
          if ((rightCp === 0x301c || rightCp === 0x30a0) && options.jaZh && !afterZwj) { out.push(pos); continue next }
          break
        case 'loose': {
          const b = looseBreak(rightCp, left, right, options.jaZh)
          if (b !== null) {
            if (b && !afterZwj) { out.push(pos); continue next }
            continue
          }
          break
        }
        case 'anywhere':
          out.push(pos)
          continue next
        case 'strict':
          break
      }
      // Complex scripts (line.rs:940-950): the strict property of both sides is SA.
      if (options.wordOption !== 'break-all' && icu4xProperty(d, leftCp) === SA && icu4xProperty(d, rightCp) === SA) {
        // line_handle_complex_language, Utf16 (line.rs:1263-1316). Code points are truncated to u16 there.
        const startFront = front, startPos = pos, startCp = cp
        const units = [leftCp & 0xffff]
        for (;;) {
          units.push(cp & 0xffff)
          advance()
          if (pos < 0 || icu4xProperty(d, cp) !== SA) break
        }
        front = startFront; pos = startPos; cp = startCp
        cache = segmentComplex(units, dictionary)
        if (cache.length > 0) {
          const firstPos = cache[0]!
          let i = 1
          for (;;) {
            if (i === firstPos) {
              const rest: number[] = []
              for (let k = 1; k < cache.length; k++) rest.push(cache[k]! - i)
              cache = rest
              out.push(pos)
              continue next
            }
            i += 1
            advance()
            if (pos < 0) { out.push(len); return out }
          }
        }
      }
      const s = state(left, right) // line.rs:953-1076
      if (s === BREAK || s === NO_MATCH) {
        if (afterZwj) continue
        out.push(pos)
        continue next
      }
      if (s === KEEP) continue
      let index = s >= INTERMEDIATE ? s - INTERMEDIATE : s
      let prevFront = front, prevPos = pos, prevCp = cp
      let previousIsAfterZwj = afterZwj
      let leftPropPreLb9 = right
      const isIntermediateRuleNoMatch = lb8aAfterLb9 ? true : index > d.lastCodepointProperty
      for (;;) {
        advance()
        const innerAfterZwj = leftPropPreLb9 === ZWJ
        const previousBreakStateIsCpProp = index <= d.lastCodepointProperty
        if (pos < 0) {
          if (state(index, d.eotProperty) === NO_MATCH) {
            front = prevFront; pos = prevPos; cp = prevCp
            if (previousIsAfterZwj) continue outer
            out.push(pos)
            continue next
          }
          out.push(len)
          return out
        }
        const p = prop(cp)
        if ((p === CM || p === ZWJ) && leftPropPreLb9 !== BK && leftPropPreLb9 !== CR && leftPropPreLb9 !== LF &&
          leftPropPreLb9 !== NL && leftPropPreLb9 !== SP && leftPropPreLb9 !== ZW) {
          leftPropPreLb9 = p
          continue
        }
        const n = state(index, p)
        if (n === KEEP) continue outer
        if (n === NO_MATCH) {
          front = prevFront; pos = prevPos; cp = prevCp
          if (innerAfterZwj) {
            if (isIntermediateRuleNoMatch && !previousIsAfterZwj) { out.push(pos); continue next }
            continue outer
          }
          if (previousIsAfterZwj) continue outer
          out.push(pos)
          continue next
        }
        if (n === BREAK) {
          if (innerAfterZwj) continue outer
          out.push(pos)
          continue next
        }
        if (n >= INTERMEDIATE) {
          index = n - INTERMEDIATE
          prevFront = front; prevPos = pos; prevCp = cp
          previousIsAfterZwj = innerAfterZwj
        } else {
          index = n
          if (previousBreakStateIsCpProp) {
            prevFront = front; prevPos = pos; prevCp = cp
            previousIsAfterZwj = innerAfterZwj
          }
        }
        leftPropPreLb9 = p
      }
    }
  }
}

export type WordBreakRule = 'normal' | 'break-all' | 'keep-all'
export type LineBreakRule = 'auto' | 'loose' | 'normal' | 'strict' | 'anywhere'

// LineBreaker::ComputeBreakPositions (LineBreaker.cpp:112-194). `st` receives 1 at every boundary below the word
// length, 0 elsewhere.
function computeBreakPositions(word: string, wordBreak: WordBreakRule, lineBreak: LineBreakRule, cj: boolean,
  st: Uint8Array, base: number, dictionary: DictionaryBreaks): void {
  if (word.length === 1) { st[base] = 1; return } // :120-127
  st.fill(0, base, base + word.length) // :153
  // :26-41 strictness; :57-110 the auto segmenter has the same defaults (Strict, Normal, no ja_zh).
  let strictness: Strictness
  switch (lineBreak) {
    case 'auto': case 'strict': strictness = 'strict'; break
    case 'normal': strictness = 'normal'; break
    case 'loose': strictness = 'loose'; break
    case 'anywhere': strictness = 'anywhere'; break
  }
  const boundaries = icu4xLineBoundaries(word, { strictness, wordOption: wordBreak, jaZh: cj }, dictionary)
  for (let i = 0; i < boundaries.length; i++) {
    const pos = boundaries[i]!
    if (pos >= word.length) break
    st[base + pos] = 1
  }
}

// nsLineBreaker flags (nsLineBreaker.h).
export const BREAK_SUPPRESS_INITIAL = 1
export const BREAK_SUPPRESS_INSIDE = 2
export const BREAK_SKIP_SETTING_NO_BREAKS = 4

// The text run characters a break sink writes to: gfxTextRun::SetPotentialLineBreaks over [offset, offset + length).
export type BreakSink = {
  breakFlags: Uint8Array
  clusterStart: Uint8Array
  isSpace: Uint8Array
  // Global index of the sink's text run start and the flow's start inside the run.
  textRunStart: number
  flowStart: number
  // Flags::NoBreaks of the text run: set when the run is built, cleared once a sink changes a flag
  // (nsTextFrame.cpp:1227-1235, :2372).
  run: { noBreaks: boolean }
}

// gfxTextRun::SetPotentialLineBreaks (gfxTextRun.cpp:210-236): no break inside a cluster unless after a space; a
// break replaces an emergency flag, NONE leaves it.
function setBreaks(sink: BreakSink, offset: number, flags: Uint8Array, from: number, count: number): void {
  for (let k = 0; k < count; k++) {
    const i = sink.flowStart + offset + k
    let v = flags[from + k]!
    if (v !== 0 && sink.clusterStart[i] === 0 && (i === sink.textRunStart || sink.isSpace[i - 1] === 0)) v = BREAK_NONE
    if (v !== 0) {
      if (sink.breakFlags[i] !== v) sink.run.noBreaks = false
      sink.breakFlags[i] = v
    }
  }
}

type TextItem = { sink: BreakSink; sinkOffset: number; length: number; flags: number }

// kNonBreakableASCII (nsLineBreaker.cpp:33-48): true for " # & ' * , . 0-9 : ; < = > @ A-Z ^ _ ` a-z ~ DEL".
const NON_BREAKABLE_ASCII = [
  0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0,
]
const isNonBreakableChar = (ch: number) => ch >= 0x20 && ch <= 0x7f && NON_BREAKABLE_ASCII[ch - 0x20] === 1
const isSegmentSpace = (u: number) => u === 0x20 || u === 0x09 || u === 0x0d // nsLineBreaker.h:260-264

export class LineBreakerState {
  word: number[] = []
  items: TextItem[] = []
  wordMightBreak = false
  wordLang: string | null = null
  mixedLang = false
  cj = false
  afterBreakableSpace = false
  breakHere = false
  wordBreak: WordBreakRule = 'normal'
  lineBreak: LineBreakRule = 'auto'
  readonly dictionary: DictionaryBreaks

  constructor(dictionary: DictionaryBreaks) {
    this.dictionary = dictionary
  }

  // nsLineBreaker.h SetWordBreak / SetStrictness.
  setWordBreak(mode: WordBreakRule): void {
    if (mode !== this.wordBreak && this.word.length > 0) {
      this.flushWord()
      if (this.wordBreak === 'break-all') this.breakHere = true
    }
    this.wordBreak = mode
  }

  setStrictness(mode: LineBreakRule): void {
    if (mode !== this.lineBreak && this.word.length > 0) {
      this.flushWord()
      if (this.lineBreak === 'anywhere') this.breakHere = true
    }
    this.lineBreak = mode
  }

  // FlushCurrentWord (nsLineBreaker.cpp:134-226).
  flushWord(): void {
    const length = this.word.length
    const st = new Uint8Array(length)
    if (this.lineBreak === 'anywhere') st.fill(BREAK_NORMAL)
    else if (!this.wordMightBreak && this.wordBreak !== 'break-all') st.fill(BREAK_NONE)
    else computeBreakPositions(String.fromCharCode(...this.word), this.wordBreak, this.lineBreak, this.cj, st, 0, this.dictionary)
    let offset = 0
    for (let i = 0; i < this.items.length; i++) {
      const ti = this.items[i]!
      if ((ti.flags & BREAK_SUPPRESS_INITIAL) !== 0 && ti.sinkOffset === 0) st[offset] = BREAK_NONE
      if ((ti.flags & BREAK_SUPPRESS_INSIDE) !== 0) {
        const exclude = ti.sinkOffset === 0 ? 1 : 0
        st.fill(BREAK_NONE, offset + exclude, offset + ti.length)
      }
      const skipSet = i === 0 ? 1 : 0
      setBreaks(ti.sink, ti.sinkOffset + skipSet, st, offset + skipSet, ti.length - skipSet)
      offset += ti.length
    }
    this.word = []
    this.items = []
    this.wordMightBreak = false
    this.mixedLang = false
    this.wordLang = null
  }

  // UpdateCurrentWordLanguage (nsLineBreaker.cpp:652-690).
  updateLang(lang: string | null): void {
    if (this.wordLang !== null && this.wordLang !== lang) {
      this.mixedLang = true
      this.cj = false
      return
    }
    if (lang !== null && this.wordLang === null) {
      const cj = scriptIsChineseOrJapanese(lang)
      if (cj === null) return
      this.cj = cj
    }
    this.wordLang = lang
  }

  // AppendInvisibleWhitespace (nsLineBreaker.cpp:695-708).
  appendInvisibleWhitespace(flags: number): void {
    this.flushWord()
    const isBreakableSpace = (flags & BREAK_SUPPRESS_INSIDE) === 0
    if (this.afterBreakableSpace && !isBreakableSpace) this.breakHere = true
    this.afterBreakableSpace = isBreakableSpace
  }

  // AppendText, 16-bit (:235-400) and 8-bit (:505-650). `text` is the flow's transformed text.
  appendText(lang: string | null, text: Uint16Array, is16bit: boolean, flags: number, sink: BreakSink): void {
    const length = text.length
    let offset = 0
    if (this.word.length > 0) {
      while (offset < length && !isSegmentSpace(text[offset]!)) {
        this.word.push(text[offset]!)
        if (!this.wordMightBreak && !isNonBreakableChar(text[offset]!)) this.wordMightBreak = true
        if (is16bit) this.updateLang(lang)
        offset++
      }
      if (offset > 0) this.items.push({ sink, sinkOffset: 0, length: offset, flags })
      if (offset === length) return
      this.flushWord()
    }
    const st = new Uint8Array(length)
    const start = offset
    const all = BREAK_SUPPRESS_INITIAL | BREAK_SUPPRESS_INSIDE | BREAK_SKIP_SETTING_NO_BREAKS
    const noBreaksNeeded = (flags & all) === all && !this.breakHere && !this.afterBreakableSpace
    if (noBreaksNeeded) {
      offset = length
      while (offset > start) {
        offset--
        if (isSegmentSpace(text[offset]!)) break
      }
    }
    let wordStart = offset
    let wordMightBeBreakable = false
    for (;;) {
      const ch = text[offset]!
      const isSpace = isSegmentSpace(ch)
      const isBreakableSpace = isSpace && (flags & BREAK_SUPPRESS_INSIDE) === 0
      // The 16-bit path writes only when breaks are needed; the 8-bit path always writes (:563-571), and both hand the
      // array to the sink only when breaks are needed.
      st[offset] = this.breakHere || (this.afterBreakableSpace && !isBreakableSpace) || this.wordBreak === 'break-all' ||
        this.lineBreak === 'anywhere' ? BREAK_NORMAL : BREAK_NONE
      this.breakHere = false
      this.afterBreakableSpace = isBreakableSpace
      if (isSpace || (is16bit && ch === 0x0a)) {
        if (offset > wordStart && (flags & BREAK_SUPPRESS_INSIDE) === 0) {
          if (this.lineBreak === 'anywhere') st.fill(BREAK_NORMAL, wordStart, offset)
          else if (wordMightBeBreakable) {
            const saved = st[wordStart]!
            let word = ''
            for (let k = wordStart; k < offset; k++) word += String.fromCharCode(text[k]!)
            computeBreakPositions(word, this.wordBreak, this.lineBreak, this.cj, st, wordStart, this.dictionary)
            st[wordStart] = saved
          }
        }
        wordMightBeBreakable = false
        offset++
        if (offset >= length) break
        wordStart = offset
        continue
      }
      if (!wordMightBeBreakable && !isNonBreakableChar(ch)) wordMightBeBreakable = true
      offset++
      if (offset >= length) {
        this.wordMightBreak = wordMightBeBreakable
        for (let k = wordStart; k < offset; k++) this.word.push(text[k]!)
        this.items.push({ sink, sinkOffset: wordStart, length: offset - wordStart, flags })
        offset = wordStart + 1
        if (is16bit) this.updateLang(lang)
        break
      }
    }
    if (!noBreaksNeeded) setBreaks(sink, start, st, start, offset - start)
  }

  // Reset (nsLineBreaker.cpp:710-720): whether the text ended at a break opportunity.
  reset(): boolean {
    this.flushWord()
    const trailing = this.breakHere || this.afterBreakableSpace
    this.breakHere = false
    this.afterBreakableSpace = false
    return trailing
  }
}
