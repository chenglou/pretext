// LazyLineBreakIterator (text_break_iterator.cc/.h at Chrome 153; specs/blink-text.md §2.F): one iterator over the
// whole text_content, the ICU text restarted at every line start, the space rule, Blink's generated Latin-1 pair table,
// break-all and keep-all, soft hyphens, and grapheme boundaries for kBreakCharacter.
import { DONE, NO_OVERRIDES, RuleBreakIterator, getCategory, type BreakRules } from '../../breaks/rbbi.js'
import { blinkBreakRules, blinkLinePairs, pairCanBreak, type BlinkBreakTable } from '../../breaks/tables.js'
import type { DictionaryBreaks } from '../../env.js'
import { graphemeBoundaries, graphemeRulesFor } from '../../unicode/grapheme.js'
import { LB_AL, LB_BA, LB_CM, LB_ID, LB_NU, LB_SA, isLetterOrNumber, isMark, lineBreakClass } from './props.js'
import type { IteratorSettings } from './types.js'

const SPACE = 0x20
const TAB = 0x09
const LF = 0x0a
const SHY = 0xad
const IDEOGRAPHIC_SPACE = 0x3000

// text_break_iterator.h:203-205
export function isBreakableSpace(c: number): boolean {
  return c === SPACE || c === TAB || c === LF
}

function languageOf(tag: string): string {
  return tag.split(/[-_@]/)[0]!.toLowerCase()
}

// ICU's line rule file for Blink's locale string (layout_locale.cc:368-429, text_break_iterator_icu.cc:59-94,
// brkiter.cpp:433-457; verified table in specs/blink-canvas.md §2.3). A null locale opens the UI language with the
// keywords dropped; ko@lb=strict fails to open and retries the UI language.
export function lineTable(locale: string | null, strictness: IteratorSettings['strictness'], uiLanguage: string): BlinkBreakTable {
  const auto = (language: string): BlinkBreakTable => language === 'zh' ? 'line_normal_cj' : 'line_normal'
  if (locale === null) return auto(languageOf(uiLanguage))
  const language = languageOf(locale)
  const cj = language === 'zh' || language === 'ja' || language === 'ko'
  switch (strictness) {
    case 'default': return auto(language)
    case 'normal': return cj ? 'line_normal_cj' : 'line_normal'
    case 'strict': return language === 'ko' ? auto(languageOf(uiLanguage)) : 'line'
    case 'loose': return cj ? 'line_loose_cj' : 'line_loose'
  }
}

// kBreakAllLineBreakClassTable (text_break_iterator.cc:48-110), MSB-first bits per row; rows not listed are all 0.
const BREAK_ALL_ROWS: { [row: number]: readonly number[] } = (() => {
  const alpha = [0b01101000, 0b00000100, 0b00011010, 0b10000000, 0b00000010, 0, 0]
  const rows: { [row: number]: readonly number[] } = {}
  for (const c of [1, 2, 4, 19, 24, 27, 38]) rows[c] = alpha // AI AL BA NU SA SY HL
  rows[8] = [0b01101000, 0b00000100, 0b00010010, 0, 0b00000010, 0, 0] // CL
  rows[11] = rows[21] = [0b01101000, 0b00000100, 0b00010110, 0, 0b00000010, 0, 0] // EX PO
  rows[13] = [0, 0, 0b00010000, 0, 0, 0, 0] // HY
  rows[16] = [0b01101000, 0b00000100, 0b00010000, 0, 0b00000010, 0, 0] // IS
  rows[22] = [0, 0, 0b00000100, 0, 0, 0, 0] // PR
  rows[36] = [0b01101000, 0b00000100, 0b00010010, 0b10000000, 0b00000010, 0, 0] // CP
  return rows
})()

function isLead(c: number): boolean { return (c & 0xfc00) === 0xd800 }
function isTrail(c: number): boolean { return (c & 0xfc00) === 0xdc00 }

// LineBreakPropertyValue (text_break_iterator.cc:112-119).
function lineBreakPropertyValue(lastCh: number, ch: number): number {
  if (ch === 0x2b) return LB_AL
  return lineBreakClass(isLead(lastCh) && isTrail(ch) ? ((lastCh - 0xd800) << 10) + ch - 0xdc00 + 0x10000 : ch)
}

// ShouldBreakAfterBreakAll (text_break_iterator.cc:121-143).
function shouldBreakAfterBreakAll(lastLineBreak: number, lineBreak: number, ch: number, loose: boolean): boolean {
  const row = BREAK_ALL_ROWS[lastLineBreak]
  if (row === undefined || (row[lineBreak >> 3]! & (0x80 >> (lineBreak & 7))) === 0) return false
  return !(lineBreak === LB_BA && ch !== 0x7c && !loose)
}

// ShouldKeepAfterKeepAll (text_break_iterator.cc:151-159), per UTF-16 code unit.
function shouldKeepAfterKeepAll(lastCh: number, ch: number, nextCh: number): boolean {
  const pre = isMark(ch) ? lastCh : ch
  return isLetterOrNumber(pre) && lineBreakClass(pre) !== LB_SA && isLetterOrNumber(nextCh) && lineBreakClass(nextCh) !== LB_SA
}

const NO_BREAK = 0
const CAN_BREAK = 1
const UNKNOWN = 2

type V8BreakIterator = { adoptText(text: string): void; first(): number; next(): number }
type IntlWithV8 = { v8BreakIterator: new (locales: string[], options: { type: 'line' }) => V8BreakIterator }

export class LineBreakIterator {
  readonly text: string
  readonly is8Bit: boolean
  readonly settings: IteratorSettings
  readonly uiLanguage: string
  readonly dictionaryBreaks: DictionaryBreaks
  startOffset = 0
  locale: string | null = null
  // LineBreakType in effect, after an override to kBreakCharacter.
  breakType: IteratorSettings['breakType']
  private icu: { start: number; table: BlinkBreakTable; flags: Uint8Array } | null = null
  private graphemes: { start: number; flags: Uint8Array } | null = null
  // Whether a Thai, Lao, Khmer or Myanmar run needed interior boundaries this iterator couldn't give.
  dictionaryUnavailable = false

  constructor(text: string, is8Bit: boolean, settings: IteratorSettings, uiLanguage: string, dictionaryBreaks: DictionaryBreaks) {
    this.text = text
    this.is8Bit = is8Bit
    this.settings = settings
    this.uiLanguage = uiLanguage
    this.dictionaryBreaks = dictionaryBreaks
    this.breakType = settings.breakType
  }

  // SetStartOffset drops the ICU iterator (text_break_iterator.h:159-163).
  setStartOffset(offset: number): void {
    this.startOffset = offset
  }

  table(): BlinkBreakTable {
    return lineTable(this.locale, this.settings.strictness, this.uiLanguage)
  }

  // ICU boundaries over text_content[startOffset..] with no prior context (text_break_iterator_icu.cc:735-810), as
  // flags at absolute offsets. Segments ICU hands to a dictionary engine take the running browser's own boundaries
  // inside their runs of dictionary characters (DESIGN.md §6.3).
  private icuFlags(): Uint8Array {
    const table = this.table()
    if (this.icu !== null && this.icu.start === this.startOffset && this.icu.table === table) return this.icu.flags
    const start = this.startOffset
    const sub = this.text.slice(start)
    const flags = new Uint8Array(this.text.length + 1)
    const rules = blinkBreakRules(table)
    const iterator = new RuleBreakIterator(rules, NO_OVERRIDES)
    iterator.setText(sub)
    let previous = 0
    let v8: Uint8Array | null = null
    for (let b = iterator.next(); b !== DONE; b = iterator.next()) {
      flags[start + b] = 1
      if (iterator.dictionaryCharCount > 0) {
        switch (this.dictionaryBreaks.kind) {
          case 'v8-break-iterator': {
            if (v8 === null) {
              v8 = new Uint8Array(sub.length + 1)
              const bi = new (Intl as unknown as IntlWithV8).v8BreakIterator([], { type: 'line' })
              bi.adoptText(sub)
              bi.first()
              for (let x = bi.next(); x !== -1; x = bi.next()) v8[x] = 1
            }
            this.markDictionaryRuns(rules, sub, previous, b, v8, flags, start)
            break
          }
          case 'intl-segmenter-word':
          case 'unavailable':
            this.dictionaryUnavailable = true
            break
        }
      }
      previous = b
    }
    this.icu = { start, table, flags }
    return flags
  }

  private markDictionaryRuns(rules: BreakRules, sub: string, from: number, to: number, v8: Uint8Array, flags: Uint8Array, start: number): void {
    let runStart = -1
    for (let i = from; i <= to;) {
      let dictionary = false
      let size = 1
      if (i < to) {
        let c = sub.charCodeAt(i)
        if (isLead(c) && i + 1 < sub.length && isTrail(sub.charCodeAt(i + 1))) {
          c = ((c - 0xd800) << 10) + sub.charCodeAt(i + 1) - 0xdc00 + 0x10000
          size = 2
        }
        dictionary = getCategory(rules, c) >= rules.dictCategoriesStart
      }
      if (dictionary) {
        if (runStart < 0) runStart = i
      } else if (runStart >= 0) {
        for (let x = runStart + 1; x < i; x++) if (v8[x] === 1) flags[start + x] = 1
        runStart = -1
      }
      i += size
    }
  }

  // BreakIterator::following(x) on the text from the line start: the first boundary after x, or DONE.
  private following(x: number): number {
    const flags = this.icuFlags()
    for (let b = this.startOffset + x + 1; b <= this.text.length; b++) if (flags[b] === 1) return b - this.startOffset
    return DONE
  }

  // CharacterBreakIterator over text_content[startOffset..]: char.brk for 16-bit text, every code unit but LF after CR
  // for 8-bit text (character_break_iterator.cc:106-154).
  private graphemeFlags(): Uint8Array {
    if (this.graphemes !== null && this.graphemes.start === this.startOffset) return this.graphemes.flags
    const start = this.startOffset
    const flags = new Uint8Array(this.text.length + 1)
    if (this.is8Bit) {
      for (let i = start + 1; i <= this.text.length; i++) {
        if (!(this.text.charCodeAt(i - 1) === 0x0d && this.text.charCodeAt(i) === LF)) flags[i] = 1
      }
    } else {
      const boundaries = graphemeBoundaries(this.text.slice(start), graphemeRulesFor('blink'))
      for (let i = 1; i < boundaries.length; i++) flags[start + boundaries[i]!] = 1
    }
    this.graphemes = { start, flags }
    return flags
  }

  // NextBreakablePositionBreakCharacter (text_break_iterator.cc:404-417).
  private nextBreakCharacter(pos: number): number {
    const flags = this.graphemeFlags()
    const x = pos - this.startOffset
    for (let b = this.startOffset + (x > 0 ? x - 1 : 0) + 1; b <= this.text.length; b++) if (flags[b] === 1) return b
    return this.text.length
  }

  // NextBreakablePosition (text_break_iterator.cc:267-387).
  nextBreakablePosition(pos: number, len: number): number {
    if (this.breakType === 'break-character') return this.nextBreakCharacter(pos)
    const text = this.text
    const start = this.startOffset
    const afterEverySpace = this.settings.breakSpace === 'after-every-space'
    const disableSoftHyphen = !this.settings.softHyphen
    const loose = this.settings.strictness === 'loose'
    let last = pos > start ? text.charCodeAt(pos - 1) : 0
    let lastLast = pos > start + 1 ? text.charCodeAt(pos - 2) : 0
    let nextBreak = 0
    let lastLineBreak = 0
    if (this.breakType === 'break-all') lastLineBreak = lineBreakPropertyValue(lastLast, last)
    for (let i = pos; i < len; i++, lastLast = last, last = text.charCodeAt(i - 1)) {
      const current = text.charCodeAt(i)
      // ContextChar: `last` is 0, not a space, when the iterator's text has no previous character (:185-199).
      const lastIsSpace = isBreakableSpace(last)
      if (!afterEverySpace) {
        if (isBreakableSpace(current)) continue
        if (lastIsSpace) return i
      } else {
        if (lastIsSpace || last === IDEOGRAPHIC_SPACE) return i
        if ((isBreakableSpace(current) || current === IDEOGRAPHIC_SPACE) && i + 1 < len) return i + 1
      }
      const fast = shouldBreakFast(last, lastLast, current, disableSoftHyphen)
      if (fast === CAN_BREAK) return i
      if (this.breakType === 'break-all') {
        if (!isLead(current)) {
          if (loose && (current === 0x2010 || current === 0x2013) &&
            (lastLineBreak === LB_NU || lastLineBreak === LB_AL || lastLineBreak === LB_SA || lastLineBreak === LB_ID)) return i
          const lineBreak = lineBreakPropertyValue(last, current)
          if (shouldBreakAfterBreakAll(lastLineBreak, lineBreak, current, loose)) return i > pos && isTrail(current) ? i - 1 : i
          if (lineBreak !== LB_CM) lastLineBreak = lineBreak
        }
      } else if (this.breakType === 'keep-all') {
        if (shouldKeepAfterKeepAll(lastLast, last, current)) continue
      }
      if (fast === NO_BREAK) continue
      if (nextBreak < i || nextBreak === 0) {
        if (i <= start) continue
        nextBreak = i - 1
        for (;;) {
          const following = this.following(nextBreak - start)
          if (following < 0) { nextBreak = len; break }
          nextBreak = following + start
          if (disableSoftHyphen && nextBreak > 0 && nextBreak <= len && text.charCodeAt(nextBreak - 1) === SHY) continue
          break
        }
      }
      if (i === nextBreak && !lastIsSpace) return i
    }
    return len
  }

  // IsBreakable (text_break_iterator.h:185-194).
  isBreakable(pos: number): boolean {
    return this.nextBreakablePosition(pos, Math.min(pos + 1, this.text.length)) === pos
  }

  nextBreakOpportunity(offset: number, len: number = this.text.length): number {
    return this.nextBreakablePosition(offset, len)
  }

  // PreviousBreakOpportunity (text_break_iterator.cc:460-484).
  previousBreakOpportunity(offset: number, min: number): number {
    let pos = Math.min(offset, this.text.length)
    let end = Math.min(pos + 2, this.text.length)
    while (pos > min) {
      if (this.nextBreakablePosition(pos, end) === pos) return pos
      end = pos
      if (this.is8Bit) pos--
      else pos -= pos >= 2 && isTrail(this.text.charCodeAt(pos - 1)) && isLead(this.text.charCodeAt(pos - 2)) ? 2 : 1
    }
    return min
  }
}

// Context::ShouldBreakFast (text_break_iterator.cc:216-260). `last` is 0 when there is no previous character in the
// iterator's text.
function shouldBreakFast(last: number, lastLast: number, ch: number, disableSoftHyphen: boolean): number {
  if (last < 0x21 || ch < 0x21) return NO_BREAK
  if (last === 0x2d) {
    if (ch <= 0x7f) {
      if (ch >= 0x30 && ch <= 0x39) {
        const lower = lastLast | 0x20
        return (lastLast >= 0x30 && lastLast <= 0x39) || (lower >= 0x61 && lower <= 0x7a) ? CAN_BREAK : NO_BREAK
      }
    } else {
      return UNKNOWN
    }
  }
  if (last <= 0xff && ch <= 0xff) {
    if (!pairCanBreak(blinkLinePairs(), last, ch)) return NO_BREAK
    if (disableSoftHyphen && last === SHY) return NO_BREAK
    return CAN_BREAK
  }
  return UNKNOWN
}
