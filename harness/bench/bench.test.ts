// The bench's arithmetic and texts, offline. The test name says what a change's author would see if it went wrong.
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { BrowserKind } from '../types.ts'
import { buildName } from './lib.ts'
import type { DocResult, Sample } from './page.ts'
import { report, unconfirmed, verdict, type SessionResults } from './report.ts'
import { documents, runSessions, type Planned } from './run.ts'
import { EMOJI, familyText, MESSAGE_FAMILIES, STYLE, units } from './texts.ts'

describe('the verdict', () => {
  test('a row is slower or faster only outside the band in every session: one noisy session would call a change', () => {
    expect(verdict([{ candidate: 1.2, control: 1.02 }, { candidate: 1.15, control: 0.99 }], 0.05)).toBe('slower')
    expect(verdict([{ candidate: 0.8, control: 1.02 }, { candidate: 0.85, control: 0.99 }], 0.05)).toBe('faster')
    expect(verdict([{ candidate: 1.2, control: 1.02 }, { candidate: 1.03, control: 0.99 }], 0.05)).toBe('within noise')
    expect(verdict([], 0)).toBe('within noise')
  })

  test('a session\'s band is the larger of its control\'s drift and the row\'s floor: a noisy document would call noise a change', () => {
    // The control drifted 12%: a 10% change in that session is noise.
    expect(verdict([{ candidate: 1.1, control: 1.12 }], 0.03)).toBe('within noise')
    expect(verdict([{ candidate: 1.1, control: 0.88 }], 0.03)).toBe('within noise')
    // A tight control leaves the row's floor.
    expect(verdict([{ candidate: 1.04, control: 1.0 }], 0.05)).toBe('within noise')
    expect(verdict([{ candidate: 1.06, control: 1.0 }], 0.05)).toBe('slower')
  })

  test('a third session takes back what two agreed on by chance, and adds no verdict: the confirming session would have to time every row', () => {
    // Chrome 154's rich stats on 2026-09-30, a candidate doing base's work: its copy ran 11% faster than base's in the
    // first session, and the control's copy 11% slower in the second and 11% faster in the third.
    const richStats = [{ candidate: 0.8904, control: 1.005 }, { candidate: 1.0158, control: 1.1099 }, { candidate: 1.0083, control: 0.8853 }]
    expect(verdict(richStats.slice(0, 1), 0.05)).toBe('faster')
    expect(verdict(richStats, 0.05)).toBe('within noise')
    // Safari 27's Thai layout at widths seen before on 2026-10-02: two sessions read it slower, and in the third the
    // control's copy sat 12.9% from base's.
    const thai = [{ candidate: 1.077, control: 0.973 }, { candidate: 1.147, control: 1.001 }, { candidate: 1.04, control: 1.129 }]
    expect(verdict(thai.slice(0, 2), 0.05)).toBe('slower')
    expect(verdict(thai, 0.05)).toBe('within noise')
    expect(verdict([thai[2]!, thai[0]!, thai[1]!], 0.05)).toBe('within noise')
  })
})

// Twelve rounds of an operation: base's 1,000 units in 20 ms, and the candidate's and the control's cost over base's as
// given.
const rounds = (candidate: number, control: number): Sample[][] => Array.from({ length: 12 }, (_, round) => [
  { label: 'base', ms: 20, units: 1000 }, { label: 'candidate', ms: 20 * candidate * (1 + 0.001 * (round % 3)), units: 1000 }, { label: 'control', ms: 20 * control, units: 1000 },
])
const snapshot = { visible: true, focused: true, dpr: 2 }
// One document's session as the bench saves it: each operation's [candidate, control].
function sessionOf(session: number, ops: Record<string, [number, number]>, browser = 'chrome', family = 'pre-wrap-chunks'): SessionResults {
  const id = `worst ${family}`
  return {
    browser, session, seed: '', docs: [{ row: 'worst', family, id }],
    results: { [id]: { id, timerStep: 0.005, start: snapshot, end: snapshot, ops: Object.entries(ops).map(([op, [candidate, control]]) => ({ op, rounds: rounds(candidate, control) })) } },
  }
}
const BUILDS = 'base: main (0123abc, 2026-09-30); candidate: this tree\'s src/'
const row = (all: SessionResults[], entry: string): string => report(all, { builds: BUILDS, hypotheses: false, sizes: {} }).split('\n').find(line => line.includes(` ${entry} |`))!

describe('the report', () => {
  const two = [sessionOf(0, { prepare: [1.2, 1], layout: [1.01, 1], walk: [1.1, 1.08] }), sessionOf(1, { prepare: [1.2, 1], layout: [0.99, 1], walk: [1, 0.88] })]

  test('a verdict from two sessions is marked unconfirmed: two sessions\' chance agreement would stand', () => {
    expect(unconfirmed(two)).toEqual(['worst pre-wrap-chunks'])
    expect(unconfirmed([sessionOf(0, { layout: [0.8, 1] }), sessionOf(1, { layout: [0.8, 1] })])).toEqual(['worst pre-wrap-chunks'])
    expect(unconfirmed([two[0]!, sessionOf(1, { prepare: [1, 1], layout: [0.99, 1], walk: [1, 1] })])).toEqual([])
    expect(row(two, 'prepare')).toEndWith('| slower (unconfirmed) |')
    expect(row([...two, sessionOf(2, { prepare: [1.2, 1], layout: [1, 1], walk: [1, 1] })], 'prepare')).toEndWith('| slower |')
    expect(row([...two, sessionOf(2, { prepare: [1.01, 1], layout: [1, 1], walk: [1, 1] })], 'prepare')).toEndWith('] +20.1% +20.1% +1.1% | +0.0% +0.0% +0.0% | within noise (±2.0%) |')
    expect(row(two.slice(0, 1), 'prepare')).toEndWith('| slower (hypothesis: one session) |')
  })

  test('a row without a verdict prints the widest band of its sessions: a row that a copy\'s speed left blind would read as judged to its floor', () => {
    // The worst rows' floor is 2%.
    expect(row(two, 'layout')).toEndWith('| within noise (±2.0%) |')
    expect(row(two.slice(0, 1), 'layout')).toEndWith('| within noise (±2.0%) (hypothesis: one session) |')
    // The control's copy ran 8% slower than base's in the first session and 12% faster in the second.
    expect(row(two, 'walk')).toEndWith('| +8.0% -12.0% | within noise (±12.0%) |')
    expect(row(two.slice(0, 1), 'walk')).toEndWith('| +8.0% | slower (hypothesis: one session) |')
    expect(row([two[1]!, two[0]!].map((r, session) => ({ ...r, session })), 'walk')).toEndWith('| -12.0% +8.0% | within noise (±12.0%) |')
  })

  test('a verdict on a row Firefox moves with the bundle says so: an unrelated change would be blamed for it', () => {
    const controls = (browser: string, candidate: number): SessionResults[] => [0, 1, 2].map(session => sessionOf(session, { layout: [candidate, 1], prepare: [candidate, 1] }, browser, 'controls'))
    expect(row(controls('firefox', 1.16), 'controls layout')).toEndWith('| slower (moves with the bundle) |')
    expect(row(controls('firefox', 0.84), 'controls layout')).toEndWith('| faster (moves with the bundle) |')
    expect(row(controls('firefox', 1.16).slice(0, 2), 'controls layout')).toEndWith('| slower (unconfirmed) (moves with the bundle) |')
    expect(row(controls('firefox', 1.01), 'controls layout')).toEndWith('| within noise (±2.0%) |')
    expect(row(controls('firefox', 1.16), 'controls prepare')).toEndWith('| slower |')
    expect(row(controls('chrome', 1.16), 'controls layout')).toEndWith('| slower |')
  })

  test('the rows marked are rows the bench times: a renamed row would lose its mark and say nothing', () => {
    // Every operation slower but the resize documents' first, at the three widths laid out before.
    const docs = documents(['resize', 'worst'], 'bench-test', false)
    const slower = [0, 1, 2].map(session => ({
      browser: 'firefox', session, seed: '', docs: docs.map(d => ({ row: d.row, family: d.family, id: d.id })),
      results: Object.fromEntries(docs.map(d => [d.id, { id: d.id, timerStep: 0.005, start: snapshot, end: snapshot, ops: d.ops.map(spec => ({ op: spec.op, rounds: rounds(d.row === 'resize' && spec.widths.length > 0 ? 1 : 1.3, 1) })) }])),
    }))
    const marked = report(slower, { builds: BUILDS, hypotheses: false, sizes: {} }).split('\n').filter(line => line.endsWith('| slower (moves with the bundle) |'))
    expect(marked.map(line => line.split(' | ').slice(0, 2).join(' | '))).toEqual(['| resize | latin layout at new widths', '| worst | controls layout', '| worst | invisible-tails layout'])
  })

  test('the output starts with the builds it compared, each with its commit: a pasted table wouldn\'t say what it timed', () => {
    expect(report(two, { builds: BUILDS, hypotheses: false, sizes: {} }).split('\n')[1]).toBe(BUILDS)
    expect(buildName('HEAD')).toMatch(/^HEAD \([0-9a-f]{7,}, \d{4}-\d\d-\d\d\)$/)
    expect(buildName(join(import.meta.dir, '../../src'))).toMatch(/^this tree's src\/ \(on [0-9a-f]{7,}, \d{4}-\d\d-\d\d(, with uncommitted changes)?\)$/)
  })
})

describe('the sessions', () => {
  // Stand-in browsers: every copy at base's speed, but the candidate's layout of the pre-wrap chunks at `slow`'s cost in
  // the browser and session it gives one for; a browser fails the session `fails` names for it. `given` keeps the
  // documents each session was handed.
  const run = async (browsers: BrowserKind[], sessions: number, slow: (browser: BrowserKind, session: number) => number, fails: Partial<Record<BrowserKind, number>> = {}): Promise<{ given: string[]; ids: string[][]; all: SessionResults[]; failed: Map<BrowserKind, string> }> => {
    const given: string[] = []
    const ids: string[][] = []
    const time = (browser: BrowserKind, docs: Planned[]): Promise<Map<string, DocResult>> => {
      const session = given.filter(g => g.startsWith(browser)).length
      given.push(`${browser} ${docs.length}`)
      ids.push(docs.map(d => d.id))
      if (fails[browser] === session) return Promise.reject(new Error('stalled'))
      return Promise.resolve(new Map(docs.map(d => [d.id, { id: d.id, timerStep: 0.005, start: snapshot, end: snapshot, ops: d.ops.map(spec => ({ op: spec.op, rounds: rounds(d.id === 'worst pre-wrap-chunks' && spec.op === 'layout' ? slow(browser, session) : 1, 1) })) }])))
    }
    const { all, failed } = await runSessions(browsers, sessions, seed => documents(['worst'], seed, false), { time, save: () => {}, log: () => {} })
    return { given, ids, all, failed }
  }

  test('after two sessions a row that reads slower gets its document, and no other, timed once more, and keeps the verdict only if that session agrees: noise that two sessions share would be called a change', async () => {
    const steady = await run(['chrome'], 2, () => 1.2)
    expect(steady.given).toEqual(['chrome 9', 'chrome 9', 'chrome 1'])
    expect(steady.ids[2]).toEqual(['worst pre-wrap-chunks'])
    expect(row(steady.all, 'pre-wrap-chunks layout')).toEndWith('| slower |')
    expect(row((await run(['chrome'], 2, (_, session) => (session < 2 ? 1.2 : 1))).all, 'pre-wrap-chunks layout')).toEndWith('| within noise (±2.0%) |')
    expect((await run(['chrome'], 2, () => 1)).given).toEqual(['chrome 9', 'chrome 9'])
  })

  test('each browser confirms its own rows, a faster one too: one browser\'s change would be timed again in the others, or a speedup stand unconfirmed', async () => {
    const { given, all } = await run(['chrome', 'firefox'], 2, browser => (browser === 'firefox' ? 0.8 : 1))
    expect(given).toEqual(['chrome 9', 'firefox 9', 'chrome 9', 'firefox 9', 'firefox 1'])
    expect(row(all.filter(r => r.browser === 'firefox'), 'pre-wrap-chunks layout')).toEndWith('| faster |')
  })

  test('one session gets no confirming session, and three need none: one session\'s rows would be timed twice and read as confirmed, or a calibration run a fourth session', async () => {
    const one = await run(['chrome'], 1, () => 1.2)
    expect(one.given).toEqual(['chrome 9'])
    expect(row(one.all, 'pre-wrap-chunks layout')).toEndWith('| slower (hypothesis: one session) |')
    const three = await run(['chrome'], 3, () => 1.2)
    expect(three.given).toEqual(['chrome 9', 'chrome 9', 'chrome 9'])
    expect(row(three.all, 'pre-wrap-chunks layout')).toEndWith('| slower |')
  })

  test('a browser that fails a session sits out the rest, its confirming session too, and the others go on: a stalled browser would be started again and again', async () => {
    // Firefox fails its second session, with a row that read slower in its first.
    const second = await run(['chrome', 'firefox'], 2, () => 1.2, { firefox: 1 })
    expect(second.given).toEqual(['chrome 9', 'firefox 9', 'chrome 9', 'firefox 9', 'chrome 1'])
    expect([...second.failed]).toEqual([['firefox', 'session 2: stalled']])
    expect(row(second.all.filter(r => r.browser === 'firefox'), 'pre-wrap-chunks layout')).toEndWith('| slower (hypothesis: one session) |')
    const first = await run(['chrome', 'firefox'], 3, () => 1, { firefox: 0 })
    expect(first.given).toEqual(['chrome 9', 'firefox 9', 'chrome 9', 'chrome 9'])
    expect(first.all.map(r => r.browser)).toEqual(['chrome', 'chrome', 'chrome'])
  })
})

describe('the texts', () => {
  const docs = documents(['new', 'fresh', 'rich'], 'bench-test', false)
  // A mixed message may end with a space and an emoji its text doesn't hold, which a batch's end may cut anywhere.
  const emojiTail = new RegExp(` ?[${EMOJI.join('')}]*$`, 'u')

  test('the rows that time new text never prepare a message of the corpora twice: a warm cache would read as a faster library', () => {
    // The chat documents are left out: the demo repeats sentences, and 6% of `chat`'s new paragraphs repeat an earlier
    // one whole (harness/README.md, Bench).
    for (const family of MESSAGE_FAMILIES) {
      const text = familyText(family)
      let at = 0
      for (const d of docs.filter(x => x.family === family)) {
        const messages = d.fresh !== undefined ? d.fresh.batches.flat() : d.ops.filter(op => op.batches !== undefined).flatMap(op => op.batches!.flat().map(m => (typeof m === 'string' ? m : (m as Array<{ text: string }>).map(item => item.text).join(''))))
        for (const m of messages) {
          const read = family === 'mixed' ? m.replace(emojiTail, '') : m
          const found = text.indexOf(read, at)
          expect(found).toBeGreaterThanOrEqual(at)
          at = found + read.length
        }
      }
    }
  })

  test('the line functions run on Latin and CJK messages of their own: one script\'s slower line walk would hide among the mixed ones', () => {
    const lines = documents(['lines'], 'bench-test', false)
    expect(lines.map(d => `${d.family} ${d.ops.map(op => op.op).join(' ')}`)).toEqual(['mixed stats walk stream lines', 'latin stats walk stream', 'cjk stats walk stream'])
    for (const d of lines) {
      const family = d.family as 'mixed' | 'latin' | 'cjk'
      expect({ font: d.font, lang: d.lang }).toEqual(STYLE[family])
      for (const op of d.ops) {
        expect(op.textUnits).toBeGreaterThanOrEqual(20_000)
        const texts = op.texts as string[]
        expect(units(texts)).toBe(op.textUnits!)
        for (const message of texts) expect(familyText(family)).toContain(family === 'mixed' ? message.replace(emojiTail, '') : message)
      }
    }
  })

  test('the rich row times the chat demo\'s paragraphs beside the stress items, and its styled ones alone: a change that slows items of several words would be read only on items of a word each', () => {
    type Items = Array<{ text: string }>
    const rich = docs.filter(d => d.row === 'rich')
    expect(rich.map(d => `${d.family} ${d.ops.map(op => op.op).join(' ')}`)).toEqual(['latin', 'chat', 'chat-styled'].map(family => `${family} rich-new rich-stats rich-walk rich-stream rich-seen`))
    const [stress, chat, styled] = rich.map(d => ({ kept: d.ops[1]!.texts as Items[], batch: Math.max(...d.ops[0]!.batchUnits!) }))
    const share = (lists: Items[], of: (items: Items) => boolean): number => lists.filter(of).length / lists.length
    // The stress items are a word or a space each. Most of the demo's paragraphs are one item, as 86% of all it
    // prepares are; its styled ones are several, with an item of several words in most, and in two in five an item
    // that starts inside a word, with no white space on either side of its start.
    expect(share(stress!.kept, items => items.every(item => !/\S\s|\s\S/.test(item.text)))).toBe(1)
    expect(share(chat!.kept, items => items.length === 1)).toBeGreaterThan(0.8)
    expect(share(chat!.kept, items => items.length === 1)).toBeLessThan(0.92)
    expect(share(styled!.kept, items => items.length > 1)).toBeGreaterThan(0.98)
    expect(share(styled!.kept, items => items.some(item => /\S\s+\S/.test(item.text)))).toBeGreaterThan(0.9)
    expect(share(styled!.kept, items => items.some((item, i) => i > 0 && !/\s/.test(item.text[0]!) && !/\s/.test(items[i - 1]!.text.at(-1)!)))).toBeGreaterThan(0.3)
    // A round of new text compares three batches, and the demo's paragraphs differ more than prose does: a batch of
    // them is four of the stress document's (harness/README.md, Bench).
    expect([stress!.batch, chat!.batch, styled!.batch]).toEqual([1000, 4000, 4000])
  })

  test('each family\'s new batches hold the same units: a longer batch would read as a slower library', () => {
    for (const d of docs) {
      const sizes = d.fresh !== undefined ? d.fresh.batches.map(units) : d.ops[0]!.batchUnits!
      // One unit more, or one fewer in the item lists, where a cut would split a surrogate pair.
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
      if (d.row === 'new' && d.family !== 'labels') expect(Math.min(...sizes)).toBeGreaterThan(200)
    }
  })
})
