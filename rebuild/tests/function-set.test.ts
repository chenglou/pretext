// The three checks of function-set.ts, each silent on a function set that keeps its rules and loud on one that breaks
// them. The library's own function set arrives with step 1's S3, so the set here is a toy: a greedy line breaker over
// words that measures with Canvas, whose inspected paragraph asks one question more (what a gap-only measurement is) and
// keeps gaps on its lines. Its lab path is recorded with the fake browser (fake-browser.ts) and replayed, as the library's is.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { font, paragraph, text } from '../lab/cases/build.ts'
import { makeCase } from '../lab/cases/case.ts'
import { beginCase, beginPhase, endCase } from '../lab/record.ts'
import type { LayoutPrediction } from '../lab/types.ts'
import { BUILD, USER_AGENT, installFakeBrowser } from './fake-browser.ts'
import { functionSetOf, plainEqualsInspected, pure, sweep, type FunctionSet } from './function-set.ts'
import type { InputCase, Predictor } from './replay.ts'

let restore = (): void => {}
beforeAll(() => { restore = installFakeBrowser() })
afterAll(() => restore())

type ToyParagraph = { text: string; font: string }
type ToyPrepared = { words: string[]; widths: number[]; space: number; inspect: boolean; whole: number | null }
type ToyStart = { word: number }
type ToyLine = { from: number; to: number; width: number; gaps: string[] | null }
type Slot = { width: number; left: number; right: number }

function context(fontShorthand: string): { measureText(text: string): { width: number } } {
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')!
  ctx.font = fontShorthand
  return ctx
}

const toy = {
  prepare(p: ToyParagraph, _env: unknown, inspect: boolean): ToyPrepared {
    const ctx = context(p.font)
    const words = p.text.split(' ')
    const widths = words.map(word => ctx.measureText(word).width)
    const space = ctx.measureText(' ').width
    // Asked for a gap alone.
    const whole = inspect ? ctx.measureText(p.text).width : null
    return { words, widths, space, inspect, whole }
  },
  firstLine: (prepared: ToyPrepared): ToyStart | null => (prepared.words.length > 0 ? { word: 0 } : null),
  fillLine(prepared: ToyPrepared, start: ToyStart, slot: Slot): { kind: 'line'; line: ToyLine; next: ToyStart | null; hasLineBox: boolean } {
    const available = slot.width - slot.left - slot.right
    let to = start.word + 1
    let width = prepared.widths[start.word]!
    while (to < prepared.words.length && width + prepared.space + prepared.widths[to]! <= available) {
      width += prepared.space + prepared.widths[to]!
      to++
    }
    const line: ToyLine = { from: start.word, to, width, gaps: prepared.inspect ? (width > available ? ['overflow'] : []) : null }
    return { kind: 'line', line, next: to < prepared.words.length ? { word: to } : null, hasLineBox: true }
  },
  linePieces: (prepared: ToyPrepared, line: ToyLine): unknown => ({ fragments: prepared.words.slice(line.from, line.to), width: line.width }),
  inspectLine(prepared: ToyPrepared, line: ToyLine): unknown {
    if (!prepared.inspect) throw new Error('a plain paragraph holds no inspection')
    return { geometry: { width: line.width, whole: prepared.whole }, gaps: line.gaps }
  },
}
const asSet = (set: object): FunctionSet => set as unknown as FunctionSet

// The lab's path over the toy: an inspected paragraph, every line filled, inspected and read.
const predictor: Predictor = {
  predict(c) {
    const p: ToyParagraph = { text: c.paragraph.runs.map(run => run.text).join(''), font: `${c.paragraph.font.size}px ${c.paragraph.font.family}` }
    const prepared = toy.prepare(p, null, true)
    const lines: unknown[] = []
    for (let start = toy.firstLine(prepared); start !== null;) {
      const result = toy.fillLine(prepared, start, { width: c.paragraph.width, left: 0, right: 0 })
      lines.push({ inspection: toy.inspectLine(prepared, result.line), pieces: toy.linePieces(prepared, result.line) })
      start = result.next
    }
    return { paragraph: p, layout: { env: { engine: 'toy' }, lines } } as unknown as LayoutPrediction
  },
}

function recorded(words: string, width: number): InputCase {
  const c = makeCase({ family: 'test/function-set', origin: 'test', pageLang: 'en', paragraph: { ...paragraph({ font: font('Arial', 16), lang: 'en' }, [text(words)]), width } })
  beginCase(c.id)
  beginPhase('predict')
  predictor.predict(c, { browser: 'chrome', build: BUILD.engine, languages: null })
  beginPhase('observe')
  beginPhase('paint')
  return { id: c.id, family: c.family, case: c, browser: 'chrome', env: { userAgent: USER_AGENT, devicePixelRatio: 2, pageLang: 'en' }, build: BUILD, languages: null, record: endCase() }
}

const WORDS = 'The quick brown fox jumps over the lazy dog and runs far away'

describe('the function set by name', () => {
  test('a module that lacks a function of the set is named, not run', () => {
    expect(functionSetOf({ prepare: () => null, firstLine: () => null })).toEqual({ missing: ['fillLine', 'linePieces', 'inspectLine'] })
    expect(functionSetOf(toy)).toBe(asSet(toy))
  })
})

describe('plain equals inspected', () => {
  test('a plain paragraph that gives the inspected one\'s lines from fewer questions passes, with its ask counts', () => {
    const input = recorded(WORDS, 120)
    const result = plainEqualsInspected(asSet(toy), input, predictor)
    expect(result.problem).toBeNull()
    // One question fewer than the lab's path: the whole text, asked for a gap alone.
    expect(result.asked).toBe(input.record.phases.predict[1] - input.record.phases.predict[0] - 1)
    expect(result.distinct).toBeLessThanOrEqual(result.asked)
  })

  test('other pieces from the plain paragraph fail, named by the first field', () => {
    const planted = { ...toy, linePieces: (prepared: ToyPrepared, line: ToyLine): unknown => ({ fragments: prepared.words.slice(line.from, line.to), width: prepared.inspect ? line.width : line.width + 1 }) }
    const result = plainEqualsInspected(asSet(planted), recorded(WORDS, 120), predictor)
    expect(result.problem).toMatchObject({ kind: 'problem' })
    expect(result.problem!.detail).toContain('plain differs from inspected, line: [0].pieces.width')
  })

  test('another break from the plain paragraph fails', () => {
    const planted = { ...toy, fillLine: (prepared: ToyPrepared, start: ToyStart, slot: Slot) => toy.fillLine(prepared, start, prepared.inspect ? slot : { ...slot, width: slot.width - 40 }) }
    expect(plainEqualsInspected(asSet(planted), recorded(WORDS, 120), predictor).problem!.detail).toContain('plain differs from inspected, line: [0].fill.next')
  })

  test('a plain path that asks what the lab\'s path never asked fails', () => {
    const planted = { ...toy, prepare: (p: ToyParagraph, env: unknown, inspect: boolean): ToyPrepared => {
      if (!inspect) context(p.font).measureText('only the plain path asks this')
      return toy.prepare(p, env, inspect)
    } }
    expect(plainEqualsInspected(asSet(planted), recorded(WORDS, 120), predictor).problem!.detail).toContain('the plain path asks a question the record lacks')
  })

  test('a plain path that asks the lab path\'s questions in another order fails', () => {
    const planted = { ...toy, prepare: (p: ToyParagraph, env: unknown, inspect: boolean): ToyPrepared => {
      if (inspect) return toy.prepare(p, env, inspect)
      const ctx = context(p.font)
      const space = ctx.measureText(' ').width
      const words = p.text.split(' ')
      return { words, widths: words.map(word => ctx.measureText(word).width), space, inspect, whole: null }
    } }
    expect(plainEqualsInspected(asSet(planted), recorded(WORDS, 120), predictor).problem!.detail).toContain('the plain path\'s questions aren\'t the lab path\'s or fewer')
  })

  test('a plain path that makes more contexts fails', () => {
    const planted = { ...toy, prepare: (p: ToyParagraph, env: unknown, inspect: boolean): ToyPrepared => {
      if (!inspect) context(p.font)
      return toy.prepare(p, env, inspect)
    } }
    expect(plainEqualsInspected(asSet(planted), recorded(WORDS, 120), predictor).problem!.detail).toContain('the plain path makes 2 contexts, the lab\'s path 1')
  })

  test('inspectLine that answers on a plain paragraph fails', () => {
    const planted = { ...toy, inspectLine: (_prepared: ToyPrepared, line: ToyLine): unknown => ({ geometry: { width: line.width }, gaps: line.gaps }) }
    expect(plainEqualsInspected(asSet(planted), recorded(WORDS, 120), predictor).problem!.detail).toContain('inspectLine answers on a plain paragraph')
  })
})

describe('purity', () => {
  test('pieces and inspection that only read the line pass', () => {
    expect(pure(asSet(toy), recorded(WORDS, 120), predictor).problem).toBeNull()
  })

  test('linePieces that writes into the line it reads fails, although it hands out the array it wrote into', () => {
    // Blink's old justification in small: the output adds to a size kept on the decided line, then reads it.
    const planted = { ...toy, linePieces: (prepared: ToyPrepared, line: ToyLine): unknown => {
      line.width += 4
      return toy.linePieces(prepared, line)
    } }
    expect(pure(asSet(planted), recorded(WORDS, 120), predictor).problem!.detail).toContain('linePieces gives another result the second time: width')
  })

  test('pieces that depend on whether the line was inspected first read the same twice, and fail by the order', () => {
    const inspected = new WeakSet<ToyLine>()
    const kept = new WeakMap<ToyLine, unknown>()
    const planted = {
      ...toy,
      inspectLine(prepared: ToyPrepared, line: ToyLine): unknown {
        inspected.add(line)
        return toy.inspectLine(prepared, line)
      },
      // Computed once per line and kept, from a state inspectLine leaves behind.
      linePieces(prepared: ToyPrepared, line: ToyLine): unknown {
        if (!kept.has(line)) kept.set(line, { fragments: prepared.words.slice(line.from, line.to), width: line.width + (inspected.has(line) ? 1 : 0) })
        return kept.get(line)
      },
    }
    expect(pure(asSet(planted), recorded(WORDS, 120), predictor).problem!.detail).toContain('inspectLine before linePieces gives other results than after it, line: [0].pieces.width')
  })
})

describe('width sweep on the stand-in Canvas', () => {
  test('a prepared paragraph that holds nothing of a width passes', () => {
    const result = sweep(asSet(toy), recorded(WORDS, 120), predictor)
    expect(result.problem).toBeNull()
    expect(result.asked).toBeGreaterThan(20)
  })

  test('a prepared paragraph that keeps a line from the first width it saw fails at the next', () => {
    const kept = new WeakMap<ToyPrepared, Map<number, ReturnType<typeof toy.fillLine>>>()
    const planted = { ...toy, fillLine(prepared: ToyPrepared, start: ToyStart, slot: Slot): ReturnType<typeof toy.fillLine> {
      let lines = kept.get(prepared)
      if (lines === undefined) {
        lines = new Map()
        kept.set(prepared, lines)
      }
      let line = lines.get(start.word)
      if (line === undefined) {
        line = toy.fillLine(prepared, start, slot)
        lines.set(start.word, line)
      }
      return line
    } }
    const result = sweep(asSet(planted), recorded(WORDS, 120), predictor)
    expect(result.problem!.detail).toContain('filled at 60 before 90 differs from one prepared for 90 alone')
  })
})
