// WebKit's break opportunities: BreakablePositions (fast classes, the pair table, the stale fast-forward state),
// keep-all's nextBreakableSpace, libicucore's line iterator over prior context + box content, moveToNextBreakablePosition
// and mayBreakInBetween (specs/webkit-text.md §5.2-§5.5, §7.4). Cited at WebKit-7625.1.29.11.27 under Source/WebCore/:
// BP.h = rendering/BreakablePositions.h, TU = layout/formattingContexts/inline/text/TextUtil.cpp,
// IIB = layout/formattingContexts/inline/InlineItemsBuilder.cpp, TBI = WTF/wtf/text/icu/TextBreakIteratorICU.h.
import type { WebKitEnvironment } from '../../env.js'
import { RuleBreakIterator, getCategory, ruleBoundaries, type BreakRules } from '../../breaks/rbbi.js'
import type { LineBreak } from '../../model.js'
import { dictionaryScript, isDictionaryMark, isPunctuation, lineRules, pairTableBreaks, type DictionaryScript } from './data.js'
import type { LineBreakMode, WebKitStyle } from './types.js'

// BreakClass, BP.h:80-102.
const kAL = 1
const kID = 2
const kCM = 4
const kOP = 8
const kCP = 16
const kCL = 32
const kGL = 64
const kQU = 128
const kSP = 256
const kPi = 512
const kPf = 1024
const kWeird = 32768

type DictionaryBreaks = WebKitEnvironment['dictionaryBreaks']

// CachedLineBreakIteratorFactory (WTF TextBreakIterator.h:236-351): the box content, its locale and mode, and up to two
// code units of prior context from the previous box. `icuDefaultLocale` is the process default the quote overrides read.
export type BreakFactory = {
  text: string
  is8Bit: boolean
  locale: string
  mode: LineBreakMode
  icuDefaultLocale: string
  dictionaryBreaks: DictionaryBreaks
  secondToLast: number
  last: number
  // following[i] answers following(i - 1) in text coordinates, or -1 for UBRK_DONE; built on the first ICU query.
  following: Int32Array | null
}

export function makeFactory(text: string, is8Bit: boolean, locale: string, mode: LineBreakMode, icuDefaultLocale: string, dictionaryBreaks: DictionaryBreaks): BreakFactory {
  return { text, is8Bit, locale, mode, icuDefaultLocale, dictionaryBreaks, secondToLast: 0, last: 0, following: null }
}

// PriorContext::length counts trailing non-zero units (TextBreakIterator.h:277-283).
function priorContextLength(f: BreakFactory): number {
  if (f.last === 0) return 0
  return f.secondToLast === 0 ? 1 : 2
}

function isDictionaryCharacter(rules: BreakRules, cp: number): boolean {
  return getCategory(rules, cp) >= rules.dictCategoriesStart
}

// The dictionary engine a character reaches (ICULanguageBreakFactory::loadEngineFor by uscript_getScript, brkeng.cpp:163-199)
// and the characters it takes, [[:Thai:]&[:LineBreak=SA:]] and so on (dictbe.cpp:208, 451, 651, 841), from ICU 78.2's
// ppucd Script and Line_Break values (data.ts dictionaryScript). Other SA scripts (Tai Tham, Tai Viet) reach
// UnhandledEngine, which finds no breaks.
type DictionaryEngine = DictionaryScript | 'unhandled'

function dictionaryEngine(cp: number): DictionaryEngine {
  return dictionaryScript(cp) ?? 'unhandled'
}

// Whether an engine's range holds too few characters for two words, when divideUpDictionaryRange returns no breaks: Thai
// moves four code points from the range start (dictbe.cpp:240-244), Lao, Burmese and Khmer compare code units (:480,
// :673, :879).
function tooShortForTwoWords(engine: DictionaryEngine, text: string, start: number, end: number): boolean {
  switch (engine) {
    case 'thai': {
      let index = start
      for (let k = 0; k < 4 && index < text.length; k++) index += text.codePointAt(index)! > 0xffff ? 2 : 1
      return index >= end
    }
    case 'lao':
    case 'burmese':
    case 'khmer':
      return end - start < 4
    case 'unhandled':
      return true
  }
}

// The engine ranges of a rule segment [start, end) with dictionary characters (DictionaryCache::populateDictionary, ICU
// 78.2 rbbi_cache.cpp:120-200): characters outside the dictionary categories are skipped, then the engine takes the run
// of characters it handles (DictionaryBreakEngine::findBreaks, dictbe.cpp:48-78).
function forEachDictionaryRange(rules: BreakRules, text: string, start: number, end: number, visit: (engine: DictionaryEngine, rangeStart: number, rangeEnd: number) => void): void {
  let current = start
  while (current < end) {
    while (current < end && !isDictionaryCharacter(rules, text.codePointAt(current)!)) current += text.codePointAt(current)! > 0xffff ? 2 : 1
    if (current >= end) return
    const engine = dictionaryEngine(text.codePointAt(current)!)
    let rangeEnd = current
    while (rangeEnd < end && isDictionaryCharacter(rules, text.codePointAt(rangeEnd)!) && dictionaryEngine(text.codePointAt(rangeEnd)!) === engine) {
      rangeEnd += text.codePointAt(rangeEnd)! > 0xffff ? 2 : 1
    }
    visit(engine, current, rangeEnd)
    current = rangeEnd
  }
}

// The engines' boundaries inside an engine range, from JSC's Intl.Segmenter word granularity over that range, which runs
// the same libicucore dictionaries (DESIGN.md §6.3, specs/webkit-gaps.md §4.2). The engines never stop before a
// combining mark of their script (dictbe.cpp "Never stop before a combining mark", fMarkSet), and the range end is never a
// boundary ("Don't return a break for the end of the dictionary range"). Against libicucore's line iterator over the
// groundwork's 1,556 SA texts this differs only where a range starts with a mark (breaks.test.ts), which the paragraph
// reports as dictionary-breaks-stand-in.
function addDictionaryBoundaries(source: DictionaryBreaks, rules: BreakRules, text: string, start: number, end: number, isBoundary: Uint8Array): void {
  switch (source.kind) {
    case 'intl-segmenter-word':
      forEachDictionaryRange(rules, text, start, end, (engine, rangeStart, rangeEnd) => {
        if (tooShortForTwoWords(engine, text, rangeStart, rangeEnd)) return
        const range = text.slice(rangeStart, rangeEnd)
        const segments = Array.from(new Intl.Segmenter(undefined, { granularity: 'word' }).segment(range))
        for (let k = 1; k < segments.length; k++) {
          if (!isDictionaryMark(range.codePointAt(segments[k]!.index)!)) isBoundary[rangeStart + segments[k]!.index] = 1
        }
      })
      return
    // The paragraph reports dictionary-breaks-unavailable.
    case 'unavailable':
      return
  }
}

// Whether an engine range long enough for breaks starts with a combining mark, where the line engine resynchronizes from
// its dictionary (ThaiBreakEngine::divideUpDictionaryRange's "Look for a plausible word boundary") and the word segmenter
// starts its range after the mark. The text is taken as one rule segment.
export function dictionaryRangeStartsWithMark(rules: BreakRules, text: string): boolean {
  let found = false
  forEachDictionaryRange(rules, text, 0, text.length, (engine, rangeStart, rangeEnd) => {
    if (!tooShortForTwoWords(engine, text, rangeStart, rangeEnd) && isDictionaryMark(text.codePointAt(rangeStart)!)) found = true
  })
  return found
}

// ubrk_following over prior context + text (TBI:99-147). Boundaries come from one forward pass, which equals
// ubrk_following on libicucore with the overrides (specs/webkit-canvas.md §2.6).
export function computeFollowing(f: BreakFactory): Int32Array {
  const priorLength = priorContextLength(f)
  const prior = priorLength === 2 ? String.fromCharCode(f.secondToLast, f.last) : priorLength === 1 ? String.fromCharCode(f.last) : ''
  const icuText = prior + f.text
  const { rules, overrides } = lineRules(f.locale, f.mode, f.icuDefaultLocale)
  const boundaries = ruleBoundaries(new RuleBreakIterator(rules, overrides), icuText)
  const isBoundary = new Uint8Array(icuText.length + 1)
  let segmentStart = 0
  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i]!
    isBoundary[b.offset] = 1
    if (b.dictionarySegment) addDictionaryBoundaries(f.dictionaryBreaks, rules, icuText, segmentStart, b.offset, isBoundary)
    segmentStart = b.offset
  }
  const following = new Int32Array(f.text.length + 1)
  let next = -1
  for (let p = icuText.length; p >= priorLength; p--) {
    if (isBoundary[p] === 1) next = p - priorLength
    following[p - priorLength] = next
  }
  return following
}

// BP.h:124-139
function isBreakableSpace(c: number, nbspBreaks: boolean): boolean {
  return c === 0x20 || c === 0x0a || c === 0x09 || c === 0x2028 || c === 0x2029 || (nbspBreaks && c === 0xa0)
}

function isASCIIDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39
}

function isASCIIAlpha(c: number): boolean {
  const lower = c | 0x20
  return lower >= 0x61 && lower <= 0x7a
}

// BP.h:329-539, verbatim. The LineBreakRules template argument doesn't change the result.
export function classify(c: number, nbspBreaks: boolean): number {
  switch ((c & ~0x7f) / 0x80) {
    case 0x0000 / 0x80:
      switch ((c & ~0x0f) / 0x10) {
        case 0x0000 / 0x10: return kWeird
        case 0x0010 / 0x10: return kCM
        case 0x0020 / 0x10:
          if (c === 0x20) return kSP
          if (c === 0x22 || c === 0x27) return kQU
          if (c === 0x28) return kOP
          if (c === 0x29) return kCP
          return kWeird
        case 0x0030 / 0x10: return c <= 0x39 ? kAL : kWeird
        case 0x0040 / 0x10: return kAL
        case 0x0050 / 0x10:
          if (c <= 0x5a) return kAL
          if (c === 0x5b) return kOP
          if (c === 0x5d) return kCP
          return kWeird
        case 0x0060 / 0x10: return kAL
        case 0x0070 / 0x10:
          if (c <= 0x7a) return kAL
          if (c === 0x7b) return kOP
          if (c === 0x7d) return kCL
          return kWeird
        default: return kWeird
      }
    case 0x0080 / 0x80:
      if (c === 0xa0) return nbspBreaks ? kSP : kGL
      if (c > 0xc0) return kAL
      if (c === 0xa1 || c === 0xbf) return kOP
      if (c === 0xab) return kQU | kPi
      if (c === 0xbb) return kQU | kPf
      return kWeird
    case 0x0100 / 0x80:
    case 0x0180 / 0x80:
    case 0x0200 / 0x80:
      return kAL
    case 0x0280 / 0x80:
      return c === 0x2c8 || c === 0x2cc || c === 0x2df ? kWeird : kAL
    case 0x0300 / 0x80:
      if (c === 0x34f || (c >= 0x35c && c <= 0x362)) return kGL
      if (c < 0x370) return kCM
      if (c === 0x37e) return kWeird
      return kAL
    case 0x0380 / 0x80:
    case 0x0400 / 0x80:
      return kAL
    case 0x0480 / 0x80:
      return c >= 0x483 && c <= 0x489 ? kCM : kAL
    case 0x0500 / 0x80:
      return kAL
    case 0x0580 / 0x80:
      if (c <= 0x588 || c >= 0x5c8) return kAL
      if (c >= 0x591 && c <= 0x5bd) return kCM
      switch (c) {
        case 0x5bf: case 0x5c1: case 0x5c2: case 0x5c4: case 0x5c5: case 0x5c7: return kCM
        default: return kWeird
      }
    case 0x0600 / 0x80: case 0x0680 / 0x80: case 0x0700 / 0x80: case 0x0780 / 0x80:
    case 0x0800 / 0x80: case 0x0880 / 0x80: case 0x0900 / 0x80: case 0x0980 / 0x80:
    case 0x1000 / 0x80: case 0x1080 / 0x80: case 0x1100 / 0x80: case 0x1180 / 0x80:
    case 0x1200 / 0x80: case 0x1280 / 0x80: case 0x1300 / 0x80: case 0x1380 / 0x80:
    case 0x1400 / 0x80: case 0x1480 / 0x80: case 0x1500 / 0x80: case 0x1580 / 0x80:
    case 0x1600 / 0x80: case 0x1680 / 0x80: case 0x1700 / 0x80: case 0x1780 / 0x80:
    case 0x1800 / 0x80: case 0x1880 / 0x80: case 0x1900 / 0x80: case 0x1980 / 0x80:
      return kWeird
    case 0x2000 / 0x80:
      if (c === 0x2018 || c === 0x201c) return kQU | kPi
      if (c === 0x2019 || c === 0x201d) return kQU | kPf
      return kWeird
  }
  if (c >= 0x2e80 && c <= 0xa4cf) {
    if ((c & ~0xff) === 0x3000) {
      if (c <= 0x303f) {
        switch (c & 0x1f) {
          case 0x01: case 0x02: case 0x09: case 0x0b: case 0x0d: case 0x0f: case 0x11: case 0x15: case 0x17:
          case 0x19: case 0x1b: case 0x1e: case 0x1f:
            return kCL
          case 0x08: case 0x0a: case 0x0c: case 0x0e: case 0x10: case 0x16: case 0x14: case 0x18: case 0x1a:
          case 0x1d:
            return kOP
          default:
            return kWeird
        }
      }
      return kWeird
    }
    if ((c & ~0x0f) === 0x31f0) return kWeird
    if ((c & ~0x07) === 0x3248) return kAL
    if ((c & ~0x3f) === 0x4dc0) return kAL
    if (c === 0xa015) return kWeird
    return kID
  }
  if (c >= 0xac00 && c <= 0xd7af) return kID
  if (c >= 0xf900 && c <= 0xfaff) return kID
  return kWeird
}

// BP.h:141-255 for WordBreakBehavior::Normal. `b` and `bb` are copied from the stale `a` inside the fast-forward loop,
// so a scan that stops early compares the character where ICU was asked with the current one (specs/webkit-text.md H9).
function nextBreakablePosition(f: BreakFactory, startPosition: number, rules: 'Normal' | 'Special', nbspBreaks: boolean): number {
  const s = f.text
  const length = s.length
  let start = startPosition
  if (start === 0 && priorContextLength(f) === 0) {
    if (length <= 1) return length
    start++
  }
  let bbCh = start > 1 ? s.charCodeAt(start - 2) : f.secondToLast
  let bCh = start > 0 ? s.charCodeAt(start - 1) : f.last
  let bType = 0
  let aCh = 0
  let aType = 0
  let nextBreak = -1
  for (let i = start; i < length; bbCh = bCh, bCh = aCh, bType = aType, i++) {
    aCh = s.charCodeAt(i)
    aType = 0
    if (isBreakableSpace(aCh, nbspBreaks)) return i
    if (rules === 'Normal') {
      // BP.h:170-188
      if (bCh === 0x2d && isASCIIDigit(aCh)) {
        if (isASCIIDigit(bbCh) || isASCIIAlpha(bbCh)) return i
        continue
      }
      if (bCh <= 0xff && aCh <= 0xff) {
        if (bCh >= 0x21 && aCh >= 0x21 && pairTableBreaks(bCh, aCh)) return i
        continue
      }
    }
    // BP.h:191-236
    if (bType === 0) bType = classify(bCh, nbspBreaks)
    aType = classify(aCh, nbspBreaks)
    const pair = bType | aType
    if ((pair & ~(kSP | kAL | kQU | kPi | kPf)) === 0) continue
    if ((pair | kAL) === (kID | kAL)) return i
    if ((pair & (kGL | kQU)) !== 0 && (pair & kWeird) === 0) {
      if ((pair & kID) !== 0 && (pair & kQU) !== 0 && ((aType & kPi) !== 0 || (bType & kPf) !== 0)) return i
      continue
    }
    if (aType === kCM) {
      aType = bType
      continue
    }
    if (rules === 'Normal' && (pair & kWeird) === 0 && (pair & (kCL | kCP | kOP)) !== 0) {
      if (aType === kCL || aType === kCP || bType === kOP) continue
      if ((pair & kID) !== 0) return i
    }
    // BP.h:238-251, ICU. next[i] is never -1 inside the text: the text end is always a boundary.
    if (nextBreak < i) {
      f.following ??= computeFollowing(f)
      nextBreak = f.following[i]!
    }
    if (nextBreak !== -1 && i < nextBreak) {
      for (const max = Math.min(nextBreak, length - 1); i < max; bbCh = bCh, bCh = aCh, bType = aType, i++) {
        const lookahead = s.charCodeAt(i + 1)
        if ((lookahead <= 0xff && !isASCIIAlpha(lookahead)) || (nbspBreaks && lookahead === 0xa0)) break
      }
    }
    if (i === nextBreak && !isBreakableSpace(bCh, nbspBreaks)) return i
  }
  return length
}

// BP.h:257-274. Punctuation breaks apply to 16-bit strings only (BP.h:292-299).
function nextBreakableSpace(s: string, start: number, nbspBreaks: boolean, punctuationBreaks: boolean): number {
  for (let i = start; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (isBreakableSpace(c, nbspBreaks)) return i
    if (c === 0x200b) return i
    if (c === 0x3000) return i + 1
    if (punctuationBreaks && isPunctuation(c) && i + 1 < s.length) return i + 1
  }
  return s.length
}

// TextUtil::findNextBreakablePosition (TU:398-422) with BreakablePositions::next (BP.h:287-300). NBSP breaks only under
// -webkit-nbsp-mode: space, whose initial value is normal (specs/webkit-text.md §12). break-all, break-word and
// line-break: anywhere don't change the scan.
export function findNextBreakablePosition(f: BreakFactory, start: number, style: WebKitStyle): number {
  const nbspBreaks = false
  if (style.wordBreak === 'keep-all') return nextBreakableSpace(f.text, start, nbspBreaks, !f.is8Bit)
  return nextBreakablePosition(f, start, f.mode === 'Default' ? 'Normal' : 'Special', nbspBreaks)
}

// IIB:75-87: an answer equal to the scan's own start counts when it's past the item start.
export function moveToNextBreakablePosition(startPosition: number, f: BreakFactory, style: WebKitStyle): number {
  const length = f.text.length
  for (let s = startPosition; s < length; s++) {
    const next = findNextBreakablePosition(f, s, style)
    if (next !== startPosition) return next - startPosition
  }
  return length - startPosition
}

// TextUtil::mayBreakInBetween (TU:374-396): a scan over the next box with the next box's locale and mode, seeded with the
// previous box's last two code units. A 16-bit previous box makes the next content 16-bit (:379-383). The soft-hyphen
// rule (:388-389) needs hyphens: none, which the model never has.
export function mayBreakInBetween(previousText: string, previousIs8Bit: boolean, nextText: string, nextIs8Bit: boolean, nextLocale: string, style: WebKitStyle, icuDefaultLocale: string, dictionaryBreaks: DictionaryBreaks): boolean {
  const f = makeFactory(nextText, nextIs8Bit && previousIs8Bit, nextLocale, style.lineBreakMode, icuDefaultLocale, dictionaryBreaks)
  const n = previousText.length
  f.last = n > 0 ? previousText.charCodeAt(n - 1) : 0
  f.secondToLast = n > 1 ? previousText.charCodeAt(n - 2) : 0
  return findNextBreakablePosition(f, 0, style) === 0
}

// InlineContentBreaker.cpp:124-137. Callers pass UTF-16 code units.
export function canBreakBefore(c: number, lineBreak: LineBreak): boolean {
  if (lineBreak !== 'loose' && (c === 0x2010 || c === 0x2013)) return false
  if (c === 0xa0) return false
  return c === 0x5c || !isPunctuation(c)
}
