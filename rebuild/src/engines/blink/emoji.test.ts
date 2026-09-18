// RunSegmenter's font fallback priorities on the emoji segmenter's grammar (emoji_presentation_scanner.rl): tokens and the
// kinds SymbolsIterator joins them into.
import { describe, expect, test } from 'bun:test'
import { PRIORITY_EMOJI_EMOJI, PRIORITY_EMOJI_EMOJI_WITH_VS, PRIORITY_EMOJI_TEXT_WITH_VS, PRIORITY_TEXT, emojiPriorities } from './emoji.js'

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
