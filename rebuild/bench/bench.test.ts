// The bench's inputs stay in their size classes and deterministic, and the statistics are the documented ones.
//   bun test rebuild/bench
import { describe, expect, test } from 'bun:test'
import { buildChat, buildContexts, buildInput, buildMessages, CHAT_KIND_SHARES, CHAT_LENGTH_CLASSES, CHAT_SETS, chatText, DEFAULT_CHAT_SETS, describeChat, SCENARIOS, SCRIPTS, SIZE_RANGES, SIZES, SWEEP_WIDTHS } from './cases.ts'
import { median, quantile, summarize } from './stats.ts'

describe('cases', () => {
  test('every input is in its size class', () => {
    for (let s = 0; s < SCRIPTS.length; s++) {
      for (let z = 0; z < SIZES.length; z++) {
        const text = buildInput(SCRIPTS[s]!, SIZES[z]!)
        const [min, max] = SIZE_RANGES[SIZES[z]!]
        expect(text.length).toBeGreaterThanOrEqual(min)
        expect(text.length).toBeLessThanOrEqual(max)
      }
    }
  })

  test('messages are deterministic, non-empty and chat-sized', () => {
    for (let s = 0; s < SCRIPTS.length; s++) {
      const first = buildMessages(SCRIPTS[s]!, 1000)
      expect(buildMessages(SCRIPTS[s]!, 1000)).toEqual(first)
      expect(first.length).toBe(1000)
      for (let i = 0; i < first.length; i++) {
        expect(first[i]!.length).toBeGreaterThan(0)
        expect(first[i]!.length).toBeLessThanOrEqual(410)
      }
    }
  })

  test('contexts hold one row per size per scenario and one many row, then the chat context', () => {
    const contexts = buildContexts({ scripts: SCRIPTS, sizes: SIZES, scenarios: SCENARIOS, messages: 10, chat: { sets: DEFAULT_CHAT_SETS, timed: 10, headline: 25, headlinePasses: 1, phasePasses: 1 } })
    expect(contexts.length).toBe(SCRIPTS.length + 1)
    for (let c = 0; c < SCRIPTS.length; c++) expect(contexts[c]!.rows.length).toBe(2 * SIZES.length + 1)
    expect(SWEEP_WIDTHS.length).toBe(20)
    const chat = contexts[SCRIPTS.length]!
    expect(chat.rows.map(row => row.id)).toEqual(['chat/mix', 'chat/latin'])
    expect(chat.chat!.sets.map(set => set.messages.length)).toEqual([25, 25])
  })
})

describe('chat', () => {
  test('a longer set starts with the shorter one, and no message is empty or holds a newline', () => {
    for (let s = 0; s < CHAT_SETS.length; s++) {
      const long = buildChat(CHAT_SETS[s]!, 3000)
      expect(buildChat(CHAT_SETS[s]!, 500)).toEqual(long.slice(0, 500))
      for (let i = 0; i < long.length; i++) {
        const text = chatText(long[i]!)
        expect(text.trim().length).toBeGreaterThan(0)
        expect(text.includes('\n')).toBe(false)
      }
    }
  })

  test('the mix holds every kind near its share, mostly short and medium messages and a few very long ones', () => {
    const mix = describeChat(buildChat('mix', 10000))
    for (let k = 0; k < CHAT_KIND_SHARES.length; k++) {
      const [kind, share] = CHAT_KIND_SHARES[k]!
      const found = mix.byKind.find(entry => entry.kind === kind)!.messages / mix.messages
      expect(Math.abs(found - share)).toBeLessThan(0.02)
    }
    expect(CHAT_KIND_SHARES.reduce((sum, entry) => sum + entry[1], 0)).toBeCloseTo(1)
    expect(CHAT_LENGTH_CLASSES.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(1)
    expect((mix.byLength[0]!.messages + mix.byLength[1]!.messages) / mix.messages).toBeGreaterThan(0.65)
    expect(mix.byLength[3]!.messages).toBeGreaterThan(0)
    expect(mix.withCodeSpan).toBe(mix.byKind.find(entry => entry.kind === 'latin-code')!.messages)
    expect(mix.withEmoji).toBeGreaterThan(0)
    expect(mix.withUrl).toBeGreaterThan(0)
  })

  test('the real set starts with its shorter self, holds the mix\'s kinds near their shares, and reads its English texts once in 4,000 messages', () => {
    const long = buildChat('real', 4000)
    expect(buildChat('real', 500)).toEqual(long.slice(0, 500))
    const real = describeChat(long)
    for (let k = 0; k < CHAT_KIND_SHARES.length; k++) {
      const [kind, share] = CHAT_KIND_SHARES[k]!
      expect(Math.abs(real.byKind.find(entry => entry.kind === kind)!.messages / real.messages - share)).toBeLessThan(0.02)
    }
    // No two long plain-ASCII messages are the same text, which random slices of one text can't promise.
    const seen = new Set<string>()
    for (let i = 0; i < long.length; i++) {
      const text = chatText(long[i]!)
      expect(text.trim().length).toBeGreaterThan(0)
      expect(text.includes('\n')).toBe(false)
      if (long[i]!.kind !== 'latin' || text.length < 40) continue
      expect(seen.has(text)).toBe(false)
      seen.add(text)
    }
  })

  // Counts and times of different days are held against each other, so a change to the generator must not move these sets
  // by accident (the real set's first form swapped two draws and moved 407 of the mix's 10,000 messages). The digests are
  // b2d9050's; a change that means to move a set changes them by name.
  test('the mix and the latin set are the messages every earlier number was taken on', () => {
    const digest = (set: 'mix' | 'latin'): string => new Bun.CryptoHasher('sha256').update(JSON.stringify(buildChat(set, 2000))).digest('hex').slice(0, 16)
    expect(digest('mix')).toBe('c81763a2e738cd77')
    expect(digest('latin')).toBe('b6cc92fda14dd6e9')
  })

  test('the latin set is printable ASCII in one part', () => {
    const latin = buildChat('latin', 2000)
    for (let i = 0; i < latin.length; i++) {
      expect(latin[i]!.parts.length).toBe(1)
      expect(/^[ -~]+$/.test(chatText(latin[i]!))).toBe(true)
    }
  })
})

describe('stats', () => {
  test('nearest-rank p95 and median', () => {
    const values = Array.from({ length: 40 }, (_, i) => i + 1)
    expect(quantile(values, 0.95)).toBe(38)
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })

  test('outliers and heap drops', () => {
    const stats = summarize([1, 1, 1, 1, 10], 7, [false, true, false, false, true])
    expect(stats.n).toBe(5)
    expect(stats.reps).toBe(7)
    expect(stats.medianMs).toBe(1)
    expect(stats.outliers).toBe(1)
    expect(stats.heapDropSamples).toBe(2)
    expect(summarize([1, 2], 1, null).heapDropSamples).toBeNull()
  })
})
