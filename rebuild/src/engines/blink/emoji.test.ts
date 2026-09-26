// RunSegmenter's font fallback priorities on the emoji segmenter's grammar (emoji_presentation_scanner.rl): tokens and the
// kinds SymbolsIterator joins them into.
import { describe, expect, test } from 'bun:test'
import { scriptsPerUnit } from './script.js'
import { PRIORITY_EMOJI_EMOJI, PRIORITY_EMOJI_EMOJI_WITH_VS, PRIORITY_EMOJI_TEXT_WITH_VS, PRIORITY_TEXT, ShapingSegments, emojiPriorities } from './emoji.js'

const T = PRIORITY_TEXT, E = PRIORITY_EMOJI_EMOJI, EV = PRIORITY_EMOJI_EMOJI_WITH_VS, TV = PRIORITY_EMOJI_TEXT_WITH_VS

describe('blink emoji priorities', () => {
  test('an emoji with default emoji presentation is a run of its own; a lone ZWJ after it is text', () => {
    // a 👩 ZWJ SHY 🚀 b: the ZWJ joins nothing, so the woman ends her token and the ZWJ starts a text one.
    expect([...emojiPriorities('a\u{1f469}‍­\u{1f680}b')]).toEqual([T, E, E, T, T, E, E, T])
  })
  test('a ZWJ sequence is one emoji token, VS16 inside it included', () => {
    expect([...emojiPriorities('\u{1f469}‍\u{1f4bb}')]).toEqual([E, E, E, E, E])
    expect([...emojiPriorities('❤️‍\u{1f525}')]).toEqual([E, E, E, E, E])
  })
  test('text-default emoji: text alone, emoji with VS16, text with VS15; keycaps', () => {
    expect([...emojiPriorities('❤')]).toEqual([T])
    expect([...emojiPriorities('❤️')]).toEqual([EV, EV])
    expect([...emojiPriorities('❤︎')]).toEqual([TV, TV])
    expect([...emojiPriorities('1️⃣x')]).toEqual([EV, EV, EV, T])
  })
  test('flags pair up, modifier sequences and tag sequences are one token', () => {
    expect([...emojiPriorities('\u{1f1ef}\u{1f1f5}\u{1f1eb}')]).toEqual([E, E, E, E, T, T])
    expect([...emojiPriorities('\u{1f44d}\u{1f3fd}')]).toEqual([E, E, E, E])
  })
  test('ASCII and Latin-1 text has no emoji run', () => {
    expect([...emojiPriorities('a1#*')]).toEqual([T, T, T, T])
    expect([...emojiPriorities('©')]).toEqual([T])
  })
})


test('priority and group cuts preserve script-only measurement ranges and the numeric direction exception', () => {
  // The first call sees only digits; the second also sees a letter. This intentionally supplies the analyzed script
  // so that clipping the direction rule at the actual group edge is independently visible.
  const text = '١٢٣ب👍🏽'
  const scripts = new Uint8Array(text.length).fill(2)
  const priorities = emojiPriorities(text)
  const groupOfUnit = new Int32Array(text.length).fill(1)
  groupOfUnit.fill(0, 0, 2)
  const shape = new ShapingSegments(text, scripts, priorities, [
    { start: 0, end: 2, style: 0, rtl: false, cuts: [], prefixAtCut: [], startTrim16: 0, endTrim16: 0, prefix16: new Float64Array(0), pair16: new Float64Array(0), wide16: new Float64Array(0), words: false, whole: null },
    { start: 2, end: text.length, style: 0, rtl: false, cuts: [], prefixAtCut: [], startTrim16: 0, endTrim16: 0, prefix16: new Float64Array(0), pair16: new Float64Array(0), wide16: new Float64Array(0), words: false, whole: null },
  ], groupOfUnit)
  expect(shape.scriptEnd(0)).toBe(text.length)
  expect(shape.scriptEnd(2)).toBe(text.length)
  expect(shape.isEdge(2)).toBe(false)
  expect(shape.isEdge(4)).toBe(true)
  expect(shape.reversedAt(0)).toBe(false)
  expect(shape.reversedAt(2)).toBe(true)
  expect(shape.reversedAt(4)).toBe(true)
})


test('script and emoji edges keep complete surrogate pairs and ignore an empty partition', () => {
  const text = 'A😀B'
  const scripts = new Uint8Array([25, 0, 0, 25])
  const shape = new ShapingSegments(text, scripts, emojiPriorities(text), [], new Int32Array(text.length).fill(-1))
  expect(Array.from({ length: text.length }, (_, k) => shape.scriptAt(k))).toEqual([25, 0, 0, 25])
  expect(shape.scriptEnd(0)).toBe(1)
  expect(shape.scriptEnd(1)).toBe(3)
  expect(shape.scriptEnd(2)).toBe(3)
  expect(shape.isEdge(1)).toBe(true)
  expect(shape.isEdge(2)).toBe(false)
  expect(shape.isEdge(3)).toBe(true)
  expect(() => new ShapingSegments('', new Uint8Array(0), new Uint8Array(0), [], new Int32Array(0))).not.toThrow()
})


test('lone lows retain exact source scripts and each native direction inside accepted shaping segments', () => {
  const fixtures = [
    { text: 'ب\uDC00ب', ltr: [true, false, true], rtl: [false, true, false] },
    { text: '١\uDC00٢', ltr: [false, false, false], rtl: [false, true, false] },
    { text: '١\uDC00ب', ltr: [false, false, true], rtl: [false, true, false] },
    { text: 'ب\uDC00\uDC01ب', ltr: [true, false, false, true], rtl: [false, true, true, false] },
  ]
  for (const fixture of fixtures) for (const rtl of [false, true]) {
    const text = fixture.text, scripts = scriptsPerUnit(text)
    expect([...scripts]).toEqual(text.length === 3 ? [2, 103, 2] : [2, 103, 103, 2])
    for (const clipped of [false, true]) {
      const starts = clipped ? Array.from({ length: text.length }, (_, k) => k) : [0]
      const groups = starts.map((start, k) => ({ start, end: starts[k + 1] ?? text.length, rtl, style: 0, cuts: [],
        prefixAtCut: [], startTrim16: 0, endTrim16: 0, prefix16: new Float64Array(0), pair16: new Float64Array(0), wide16: new Float64Array(0), words: false, whole: null }))
      const groupOfUnit = Int32Array.from({ length: text.length }, (_, k) => clipped ? k : 0)
      const shape = new ShapingSegments(text, scripts, emojiPriorities(text), groups, groupOfUnit)
      expect(Array.from({ length: text.length }, (_, k) => shape.scriptAt(k))).toEqual([...scripts])
      expect(shape.scriptEnd(0)).toBe(1)
      expect(shape.scriptEnd(1)).toBe(text.length - 1)
      expect(shape.isEdge(1)).toBe(false)
      expect(shape.isEdge(text.length - 1)).toBe(true)
      expect(Array.from({ length: text.length }, (_, k) => shape.reversedAt(k))).toEqual(rtl ? fixture.rtl : fixture.ltr)
    }
  }
})
