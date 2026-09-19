// LazyLineBreakIterator (text_break_iterator.cc/.h at Chrome 153; specs/blink-text.md §2.F): one iterator over the
// whole text_content, the ICU text restarted at every line start, the space rule, Blink's generated Latin-1 pair table,
// break-all and keep-all, soft hyphens, and grapheme boundaries for kBreakCharacter.
import { pairCanBreak } from '../../breaks/pair-table.js'
import { DONE, NO_OVERRIDES, RuleBreakIterator, getCategory } from '../../breaks/rbbi.js'
import type { BlinkEnvironment } from '../../env.js'
import { blinkBreakRules, blinkLinePairs } from './data.js'
import type { BlinkBreakTable } from './generated/break-tables.js'
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

export function languageOf(tag: string): string {
  return tag.split(/[-_@]/)[0]!.toLowerCase()
}

// ICU's line rule file for Blink's locale string (layout_locale.cc:368-429, text_break_iterator_icu.cc:59-94,
// brkiter.cpp:433-457; verified table in specs/blink-canvas.md §2.3). A null locale opens the UI language with the
// keywords dropped; ko@lb=strict fails to open and retries the UI language. When the UI language isn't given, those
// cases open the table every UI language but Chinese opens, line_normal, and the paragraph reports ui-language.
export function lineTable(locale: string | null, strictness: IteratorSettings['strictness'], uiLanguage: string | null): BlinkBreakTable {
  const auto = (language: string): BlinkBreakTable => language === 'zh' ? 'line_normal_cj' : 'line_normal'
  if (locale === null) return auto(uiLanguage === null ? '' : languageOf(uiLanguage))
  const language = languageOf(locale)
  const cj = language === 'zh' || language === 'ja' || language === 'ko'
  switch (strictness) {
    case 'default': return auto(language)
    case 'normal': return cj ? 'line_normal_cj' : 'line_normal'
    case 'strict': return language === 'ko' ? auto(uiLanguage === null ? '' : languageOf(uiLanguage)) : 'line'
    case 'loose': return cj ? 'line_loose_cj' : 'line_loose'
  }
}

// Whether text_content[from, to) holds a character the line table hands to a dictionary engine (ICU's dictionary
// categories, rbbi.ts), where interior boundaries come from the running browser (DESIGN.md §6.3).
export function hasDictionaryCharacters(text: string, from: number, to: number, table: BlinkBreakTable): boolean {
  const rules = blinkBreakRules[table]
  for (let i = from; i < to;) {
    const cp = text.codePointAt(i)!
    if (getCategory(rules, cp) >= rules.dictCategoriesStart) return true
    i += cp > 0xffff ? 2 : 1
  }
  return false
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

// The boundaries an ICU rule iterator gives over text_content from `start`, with no prior context, pulled as the line
// asks for them: a line reads little past its own end, and every line start restarts the text.
type Boundaries = {
  start: number
  table: BlinkBreakTable
  // Over text_content[start..]; its `text` is that string.
  iterator: RuleBreakIterator
  // Absolute offsets in ascending order, without `start`: what the iterator has given so far, and inside the dictionary
  // runs it passed the running browser's own.
  found: number[]
  done: boolean
  // The running browser's line boundaries over the iterator's text, asked when the first dictionary segment comes by.
  v8: Uint8Array | null
}

export class LineBreakIterator {
  readonly text: string
  readonly is8Bit: boolean
  // The current style's settings: SetCurrentStyleForce sets strictness, break type, soft hyphens and break-space on the
  // one iterator (line_breaker.cc:4557-4643).
  settings: IteratorSettings
  readonly uiLanguage: string | null
  readonly dictionaryBreaks: BlinkEnvironment['dictionaryBreaks']
  startOffset = 0
  locale: string | null = null
  // LineBreakType in effect, after an override to kBreakCharacter.
  breakType: IteratorSettings['breakType']
  private icu: Boundaries | null = null
  private graphemes: Boundaries | null = null

  constructor(text: string, is8Bit: boolean, settings: IteratorSettings, uiLanguage: string | null, dictionaryBreaks: BlinkEnvironment['dictionaryBreaks']) {
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

  // The boundaries of `table` over the text from the line start, kept while the start and the table stay.
  private boundaries(kept: Boundaries | null, table: BlinkBreakTable): Boundaries {
    if (kept !== null && kept.start === this.startOffset && kept.table === table) return kept
    const iterator = new RuleBreakIterator(blinkBreakRules[table], NO_OVERRIDES)
    iterator.setText(this.text.slice(this.startOffset))
    return { start: this.startOffset, table, iterator, found: [], done: false, v8: null }
  }

  // The first boundary after absolute offset `after`, or DONE. Segments ICU hands to a dictionary engine take the running
  // browser's own boundaries inside their runs of dictionary characters (DESIGN.md §6.3); char.brk has no dictionary
  // category, so grapheme boundaries never do.
  private boundaryAfter(b: Boundaries, after: number): number {
    while (!b.done && (b.found.length === 0 || b.found[b.found.length - 1]! <= after)) {
      const previous = b.found.length === 0 ? 0 : b.found[b.found.length - 1]! - b.start
      const next = b.iterator.next()
      if (next === DONE) { b.done = true; break }
      if (b.iterator.dictionaryCharCount > 0) {
        switch (this.dictionaryBreaks.kind) {
          case 'v8-break-iterator': {
            if (b.v8 === null) {
              b.v8 = new Uint8Array(b.iterator.text.length + 1)
              const bi = new (Intl as unknown as IntlWithV8).v8BreakIterator([], { type: 'line' })
              bi.adoptText(b.iterator.text)
              bi.first()
              for (let x = bi.next(); x !== -1; x = bi.next()) b.v8[x] = 1
            }
            this.addDictionaryRuns(b, previous, next, b.v8)
            break
          }
          case 'unavailable':
            break
        }
      }
      b.found.push(b.start + next)
    }
    let lo = 0
    let hi = b.found.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (b.found[mid]! <= after) lo = mid + 1
      else hi = mid
    }
    return lo < b.found.length ? b.found[lo]! : DONE
  }

  // The running browser's boundaries strictly inside each run of dictionary characters of the segment [from, to) the
  // iterator just gave, in ascending order.
  private addDictionaryRuns(b: Boundaries, from: number, to: number, v8: Uint8Array): void {
    const rules = b.iterator.rules
    const sub = b.iterator.text
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
        for (let x = runStart + 1; x < i; x++) if (v8[x] === 1) b.found.push(b.start + x)
        runStart = -1
      }
      i += size
    }
  }

  // BreakIterator::following(x) on the text from the line start (text_break_iterator_icu.cc:735-810): the first boundary
  // after x, or DONE.
  private following(x: number): number {
    this.icu = this.boundaries(this.icu, this.table())
    const b = this.boundaryAfter(this.icu, this.startOffset + x)
    return b === DONE ? DONE : b - this.startOffset
  }

  // NextBreakablePositionBreakCharacter (text_break_iterator.cc:404-417) with CharacterBreakIterator over
  // text_content[startOffset..]: char.brk for 16-bit text, every code unit but LF after CR for 8-bit text
  // (character_break_iterator.cc:106-154).
  private nextBreakCharacter(pos: number): number {
    const x = pos - this.startOffset
    const after = this.startOffset + (x > 0 ? x - 1 : 0)
    if (this.is8Bit) {
      for (let b = after + 1; b <= this.text.length; b++) if (!(this.text.charCodeAt(b - 1) === 0x0d && this.text.charCodeAt(b) === LF)) return b
      return this.text.length
    }
    this.graphemes = this.boundaries(this.graphemes, 'char')
    const b = this.boundaryAfter(this.graphemes, after)
    return b === DONE ? this.text.length : b
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
    if (!pairCanBreak(blinkLinePairs, last, ch)) return NO_BREAK
    if (disableSoftHyphen && last === SHY) return NO_BREAK
    return CAN_BREAK
  }
  return UNKNOWN
}
