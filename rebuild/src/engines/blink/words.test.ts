// A group cut into words first (shape.ts addWordPieces) and a line's candidate found from the cuts' positions
// (line-breaker.ts wordCandidate), on a stand-in Canvas where every code point is 10px wide at 16px. Family `Mono` adjusts
// nothing. `Kern` kerns a space with `V` by -4px, which the pair window shows. `Context` takes 2px off where `x` stands
// before a space and `V`, which a window of one cluster on each side doesn't show and the two words together do. `Script`
// makes every space 2px narrower in a string that holds a letter, as Euphemia UCAS's space is under Latin and not under
// Common. `Far` takes 2px off a string that holds both `Q` and `Z`, a context that reaches past a word. In `Backwards` a `Q`
// is 25px narrower than nothing, so positions inside a word run backwards. `Skip` kerns every two code units by -1px.
// `Neutral` adds 3px to a string that holds no letter, as a string without a script of its own takes another script alone
// than in its run. In `SpaceScript` a lone U+2028, shaped as Common, is 2px wider than the 8-bit space, as Euphemia UCAS's
// space is. U+2060 has no advance. Measured strings carry U+2028 for U+0020 (shape.ts).
import { beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { createContextPool } from '../../measure/canvas.js'
import { UNKNOWN_FONT_FACTS, type Gap, type Paragraph } from '../../model.js'
import { fillLine, firstLine, inspectLine, paragraphGaps, prepare } from './index.js'
import { adjust16, groupPrefix16 } from './shape.js'
import type { BlinkPrepared } from './types.js'

const TEXT = 'xxxx xxxx xxxx xxx Vxxx xxxx xxxx xxxx'
const LS = String.fromCodePoint(0x2028)
const SHY = String.fromCodePoint(0xad)
const WJ = String.fromCodePoint(0x2060)

let asked: string[] = []

function count(text: string, part: string): number {
  return text.split(part).length - 1
}

class Context {
  font = '16px x'
  lang = ''
  letterSpacing = '0px'
  wordSpacing = '0px'
  fontKerning = 'auto'
  textRendering = 'auto'
  direction = 'ltr'
  measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
    asked.push(text)
    const size = parseFloat(/([\d.]+)px/.exec(this.font)![1]!)
    let width = 0
    for (let i = 0; i < text.length; i++) width += text[i] === WJ ? 0 : this.font.includes('Backwards') && text[i] === 'Q' ? -25 : 10
    if (this.font.includes('Kern') || this.font.includes('Context')) width -= 4 * count(text, `${LS}V`)
    if (this.font.includes('Context')) width -= 2 * count(text, `x${LS}V`)
    if (this.font.includes('Script') && /[a-zA-Z]/.test(text)) width -= 2 * count(text, LS)
    if (this.font.includes('Far') && text.includes('Q') && text.includes('Z')) width -= 2
    if (this.font.includes('Skip')) width -= Math.max(0, text.length - 1)
    if (this.font.includes('Neutral') && !/[a-zA-Z]/.test(text) && /\S/.test(text)) width += 3
    if (this.font.includes('SpaceScript') && text === LS) width += 2
    return { width: width * size / 16, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}

beforeAll(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})

const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}

function paragraphIn(family: string, text: string): Paragraph {
  return {
    font: { family, size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal',
    wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text }], lineHeight: 20, direction: 'ltr',
    lang: 'en', textIndent: 0, textAlign: 'start',
  }
}

function prepared(family: string, text: string = TEXT, inspect: boolean = false): BlinkPrepared {
  return prepare(paragraphIn(family, text), env, inspect, createContextPool())
}

// Every line's end, and on an inspected paragraph the gaps its lines report.
function lines(p: BlinkPrepared, width: number): { ends: number[]; gaps: Gap[] } {
  const ends: number[] = []
  const gaps: Gap[] = []
  let start = firstLine(p)
  while (start !== null) {
    const filled = fillLine(p, start, { width, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('a slot without insets never refuses a line')
    ends.push(filled.end)
    if (p.inspect !== null) gaps.push(...inspectLine(p, filled.line).gaps)
    start = filled.next
  }
  return { ends, gaps }
}

function named(gaps: readonly Gap[], name: string): Gap[] {
  return gaps.filter(gap => gap.gap === name)
}

describe('blink word pieces', () => {
  test('a group is cut after every space that passes, and its positions are sums of words', () => {
    const group = prepared('Mono').groups[0]!
    expect(group.cuts).toEqual([0, 5, 10, 15, 19, 24, 29, 34, 38])
    expect(group.prefixAtCut.map(value => value / 65536)).toEqual([0, 50, 100, 150, 190, 240, 290, 340, 380])
  })

  test('a space whose pair window shows an adjustment is no cut, and neither is one whose two words measure otherwise together', () => {
    const kern = prepared('Kern').groups[0]!
    expect(kern.cuts).toEqual([0, 5, 10, 15, 24, 29, 34, 38])
    expect(kern.prefixAtCut[kern.prefixAtCut.length - 1]! / 65536).toBe(376)
    const context = prepared('Context').groups[0]!
    expect(context.cuts).toEqual([0, 5, 10, 15, 24, 29, 34, 38])
    expect(context.prefixAtCut[context.prefixAtCut.length - 1]! / 65536).toBe(374)
  })

  test('a group of an unsegmented paragraph that holds SHY has no words', () => {
    expect(prepared('Mono', `xxxx xx${SHY}xx xxxx`).groups[0]!.cuts).toEqual([0, 15])
  })

  test('a word without a character of a script of its own stays in the piece beside it, which Canvas shapes under the script of the paragraph', () => {
    // `— ` and `12 ` alone hold no letter, so their spaces measure 2px wider than in the paragraph's run. Their two words
    // measure together what they measure apart, so as pieces of their own the group would add up to 136px.
    const text = '— 12 xxxx xxxx'
    const group = prepared('Script', text).groups[0]!
    expect(group.cuts).toEqual([0, 14])
    expect(group.prefixAtCut[group.prefixAtCut.length - 1]! / 65536).toBe(134)
    // After a word with a letter they stay in its piece. (Every space before a letter fails the pair window in `Script`, as
    // in Euphemia UCAS, where a space measured alone is Common.)
    const after = prepared('Script', 'xxxx — 12 xxxx').groups[0]!
    expect(after.cuts).toEqual([0, 14])
    expect(after.prefixAtCut[after.prefixAtCut.length - 1]! / 65536).toBe(134)
  })
})

test('in a segmented paragraph a window side that Canvas shapes as Common takes the next piece in', () => {
  // `— ` is a 16-bit string without a script of its own, so Canvas shapes it as Common alone; `, ` is Latin-1 and is
  // measured as an 8-bit string, one Latin segment, as the paragraph shapes it.
  const text = `xxxx— xxxx xxx${String.fromCodePoint(0x3c9)}`
  const p = prepared('Neutral', text)
  expect(p.groups[0]!.cuts).toEqual([0, 6, 11, 15])
  asked = []
  expect(adjust16({ p, gaps: null }, 0, 4, 0, text.length)).toBe(0)
  expect(asked).toContain(`—${LS}xxxx${LS}`)
  expect(asked).not.toContain(`—${LS}`)
  const latin = `xxxx, xxxx xxx${String.fromCodePoint(0x3c9)}`
  const q = prepared('Neutral', latin)
  asked = []
  adjust16({ p: q, gaps: null }, 0, 4, 0, latin.length)
  expect(asked).toContain(', ')
  expect(asked).not.toContain(`,${LS}xxxx${LS}`)
})

test('a window side before the offset is never taken further in: it cancels against the prefix the position measures from the same cut', () => {
  // `Script` narrows every space of a string that holds a letter. With a cut the cut search could make at 5, the position
  // before the space at 6 is the prefix at 5, `—` measured from the cut, and the wide window's adjustment. `—` alone and
  // the window's left side from the same cut are the same string, so whatever Canvas does to it cancels: 48 + 10 + 0.
  // Taking the side in to `xxxx —` leaves `—` measured alone in the prefix, and ` —`, which ends the group and has no piece
  // to take in, measured wide: 56 (the Gill Sans double count of the fonts attack, 2026-09-23).
  const text = `xxxx \u2014 \u2014`
  const p = prepared('Script', text)
  const group = p.groups[0]!
  group.cuts = [0, 5, 8]
  group.prefixAtCut = [0, 48 * 65536, 76 * 65536]
  expect(groupPrefix16({ p, gaps: null }, 0, 6) / 65536).toBe(58)
})

test('a face whose space takes another advance under Common than under Latin is cut by the cut search alone', () => {
  // TEXT is 380px: the cut search cuts it once near its middle, inside a word, since the lone space the pair window
  // measures beside every space is wider than in its run; words first would cut every word.
  expect(prepared('SpaceScript').groups[0]!.cuts).toEqual([0, 20, TEXT.length])
  expect(prepared('Mono').groups[0]!.cuts.length).toBe(9)
})

test('at a zoomed font size of 60 px and more, with the spacing two words take, a group is cut by the cut search alone, as before words', () => {
  // At 59px TEXT's words are cut first; at 60px, where two words of the widest installed face measure 256 zoomed px or
  // more and the word test can't be asked between them, the group is cut as a group without words is.
  const at = (size: number): BlinkPrepared => prepare({ ...paragraphIn('Mono', TEXT), font: { family: 'Mono', size, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS } }, env, false, createContextPool())
  expect(at(59).groups[0]!.words).toBe(true)
  expect(at(60).groups[0]!.words).toBe(false)
  // Letter and word spacing widen the two words: at 50px, 2px of letter spacing on 7 characters and 3px of word spacing
  // on 2 spaces add 20px, 4.9px of size at 4.07 em; 6px of letter spacing add 42px, 10.3px of size, past the bound.
  const spaced = (letterSpacing: number, wordSpacing: number): BlinkPrepared => prepare({ ...paragraphIn('Mono', TEXT), letterSpacing, wordSpacing, font: { family: 'Mono', size: 50, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS } }, env, false, createContextPool())
  expect(spaced(2, 3).groups[0]!.words).toBe(true)
  expect(spaced(6, 0).groups[0]!.words).toBe(false)
  expect(spaced(-6, -3).groups[0]!.words).toBe(true)
})

test('a group whose HarfBuzz call holds a mark and a letter that recomposes in such a call is cut by the cut search alone', () => {
  // The paragraph's call runs the rounds that recompose once it holds a mark anywhere, and a word measured alone without
  // one doesn't: U+1EDF (o, horn and hook above) after a `cafe` + U+0301 is written otherwise than alone.
  expect(prepared('Mono', 'cafe\u0301 xxx ph\u1edf xxxx').groups[0]!.words).toBe(false)
  // No mark in the call, or a letter of one mark, which the Latin shaper writes alike either way: words first.
  expect(prepared('Mono', 'caf\u00e9 xxx ph\u1edf xxxx').groups[0]!.words).toBe(true)
  expect(prepared('Mono', 'cafe\u0301 xxx caf\u00e9 xxxx').groups[0]!.words).toBe(true)
  // The mark in another HarfBuzz call of the group (U+FE0F in an emoji segment): words first.
  expect(prepared('Mono', 'ph\u1edf xxx \u2764\ufe0f xxxx').groups[0]!.words).toBe(true)
})

describe('blink candidate from the cuts', () => {
  test('an inspected paragraph, which searches and walks both, reports no gap of its words and gives the plain lines, at every width', () => {
    const families = ['Mono', 'Kern', 'Context']
    for (let f = 0; f < families.length; f++) {
      const plain = prepared(families[f]!)
      const inspected = prepared(families[f]!, TEXT, true)
      expect(paragraphGaps(inspected)).toEqual([])
      for (let width = 30; width <= 390; width += 7) {
        const a = lines(plain, width)
        const b = lines(inspected, width)
        expect(b.ends).toEqual(a.ends)
        expect(named(b.gaps, 'positions-run-backwards')).toEqual([])
        expect(named(b.gaps, 'context-past-a-word')).toEqual([])
      }
    }
  })

  test('a line between two words asks where the two words around its end end, and a kept paragraph asks nothing at a width it has met', () => {
    const p = prepared('Mono')
    asked = []
    expect(lines(p, 200).ends).toEqual([19, 38])
    // The position where each of the two words around the break ends (the word with its space, the word, the space, and the
    // word as the prefix), and nothing for the safe test at the second line's start: its window showed 0 when the cut was made.
    expect(asked).toEqual([`Vxxx${LS}`, 'Vxxx', LS, 'Vxxx', `xxx${LS}`, 'xxx', LS, 'xxx'])
    asked = []
    lines(p, 200)
    expect(asked).toEqual([])
  })
})

describe('blink words first: what the premises cost where a font breaks them', () => {
  test('context that reaches past a word: the words give the wrong total, and an inspected paragraph reports context-past-a-word', () => {
    // Every two words measure together what they measure apart; the whole string holds `Q` and `Z` and measures 188px.
    const text = 'xxQx xxxx xZxx xxxx'
    const plain = prepared('Far', text)
    expect(plain.groups[0]!.cuts).toEqual([0, 5, 10, 15, 19])
    expect(plain.groups[0]!.prefixAtCut[4]! / 65536).toBe(190)
    // The wrong line, pinned: natively it fits in 188px.
    expect(lines(plain, 188).ends).toEqual([15, 19])
    const inspected = prepared('Far', text, true)
    const read = lines(inspected, 188)
    expect(read.ends).toEqual([15, 19])
    // The first line read the group's total, 188px by the cut search's one piece and 190px by the words.
    expect(named(read.gaps, 'context-past-a-word').length).toBeGreaterThan(0)
  })

  test('positions that run backwards inside a word: the walk and the search differ, and an inspected paragraph reports positions-run-backwards', () => {
    // Positions 0, 10, 20, 30, 5, then the cut at 5 at 15px: at 20px the search's first probe, offset 3, is past the end
    // and it settles on 2, where the walk settles on the word after the cut.
    const text = 'xxxQ xx'
    const plain = prepared('Backwards', text)
    const inspected = prepared('Backwards', text, true)
    const a = lines(plain, 20)
    const b = lines(inspected, 20)
    expect(b.ends).toEqual(a.ends)
    const gaps = named(b.gaps, 'positions-run-backwards')
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps[0]!.detail).toContain('the walk over the cuts settles on offset 5 and the search over every offset on 2')
  })

  test('after a cut before characters every lookup skips, a position takes the adjustment of the cut once', () => {
    // `Skip` kerns every two code units by -1px and draws U+2060 with no advance, so no offset passes the safe test and the
    // cut search cuts at the middle, before U+2060, where prefixAtCut holds the pair window's -1px. The pair window of the
    // offset after U+2060 reaches back across it and shows the same -1px again: the position there is the cut's.
    const text = `${'x'.repeat(26)}${WJ}V${'x'.repeat(24)}`
    const p = prepared('Skip', text)
    expect(p.groups[0]!.cuts).toEqual([0, 26, 52])
    const sh = { p, gaps: null }
    expect(groupPrefix16(sh, 0, 26) / 65536).toBe(234)
    expect(groupPrefix16(sh, 0, 27)).toBe(groupPrefix16(sh, 0, 26))
  })
})
