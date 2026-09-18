// Tier 1's loop with no browser at all: a fake Canvas stands in for one, lab/record.ts records what the library asks it,
// and the replay must give the recorded prediction back, name a changed one by its first field, and refuse to guess an
// answer the record doesn't hold.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { beginCase, beginPhase, endCase, installRecorder } from '../lab/record.ts'
import { makeCase } from '../lab/cases/case.ts'
import { font, paragraph, text } from '../lab/cases/build.ts'
import * as predictor from '../lab/baselines/no-facts-predictor.ts'
import { newSiteTally, siteOf } from '../lab/measurements.ts'
import type { PredictEnv } from '../lab/predictor-core.ts'
import type { CaseMeasurements, RecordedCall } from '../lab/record.ts'
import type { Case, LayoutPrediction } from '../lab/types.ts'
import { classifyAsked, classifyQuestions, firstDifference, replayCase, type InputCase, type ReferenceCase } from './replay.ts'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
const BUILD = { app: 'Google Chrome', appVersion: '153.0.8010.50', engine: '153.0.8010.50', os: '26A428' }
const SETTINGS = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction', 'fontStretch', 'fontVariantCaps', 'textAlign', 'textBaseline']

// A Canvas whose widths are a fixed function of the font size and the code points, in multiples of 1/64 px.
function fakeContextClass(): new () => object {
  class Context {
    values = new Map<string, string>()
    measureText(value: string): unknown {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.values.get('font') ?? '10px')?.[1] ?? 10)
      const spacing = Number.parseFloat(this.values.get('letterSpacing') ?? '0') || 0
      let width = 0
      for (const ch of value) width += Math.round(size * (24 + (ch.codePointAt(0)! % 13)) + spacing * 64) / 64
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width, actualBoundingBoxAscent: size * 0.75, actualBoundingBoxDescent: size * 0.25, fontBoundingBoxAscent: size * 0.9, fontBoundingBoxDescent: size * 0.2 }
    }
  }
  for (const name of SETTINGS) {
    Object.defineProperty(Context.prototype, name, {
      configurable: true,
      get(this: Context): string { return this.values.get(name) ?? '' },
      set(this: Context, value: unknown): void { this.values.set(name, String(value)) },
    })
  }
  return Context
}

const globals = globalThis as Record<string, unknown>
const intl = Intl as unknown as Record<string, unknown>
const NAMES = ['OffscreenCanvasRenderingContext2D', 'CanvasRenderingContext2D', 'OffscreenCanvas', 'navigator', 'window', 'document']
const before = new Map<string, PropertyDescriptor | undefined>()
const v8Before = Object.getOwnPropertyDescriptor(intl, 'v8BreakIterator')

beforeAll(() => {
  for (const name of NAMES) before.set(name, Object.getOwnPropertyDescriptor(globals, name))
  const Offscreen = fakeContextClass()
  const define = (name: string, value: unknown): void => { Object.defineProperty(globals, name, { value, configurable: true, writable: true }) }
  define('OffscreenCanvasRenderingContext2D', Offscreen)
  define('CanvasRenderingContext2D', fakeContextClass())
  define('OffscreenCanvas', class { getContext(): object { return new Offscreen() } })
  define('navigator', { userAgent: USER_AGENT })
  define('window', { devicePixelRatio: 2 })
  define('document', { documentElement: { lang: 'en' } })
  // Chrome has Intl.v8BreakIterator, and the library's environment says whether it exists.
  intl['v8BreakIterator'] = class { adoptText(): void {} first(): number { return 0 } next(): number { return -1 } current(): number { return 0 } breakType(): string { return 'none' } resolvedOptions(): unknown { return {} } }
  installRecorder()
})

afterAll(() => {
  for (const [name, descriptor] of before) {
    if (descriptor === undefined) delete globals[name]
    else Object.defineProperty(globals, name, descriptor)
  }
  if (v8Before === undefined) delete intl['v8BreakIterator']
  else Object.defineProperty(intl, 'v8BreakIterator', v8Before)
})

const ENV: PredictEnv = { browser: 'chrome', build: BUILD.engine, languages: { engine: 'blink', uiLanguage: 'en-US' } }

function testCase(words: string, width: number): Case {
  return makeCase({ family: 'test/replay', origin: 'test', pageLang: 'en', paragraph: { ...paragraph({ font: font('Arial', 16), lang: 'en' }, [text(words)]), width } })
}

// What a browser run leaves: the record of the library's questions, and the prediction in the reference's shape.
function recordInBrowser(c: Case): { input: InputCase; browser: ReferenceCase } {
  beginCase(c.id)
  beginPhase('predict')
  const hook = predictor.predict(c, ENV) as LayoutPrediction
  beginPhase('observe')
  beginPhase('paint')
  const record = endCase(hook.layout.measure)
  const { measure, ...layout } = hook.layout
  const input: InputCase = { id: c.id, family: c.family, case: c, browser: 'chrome', env: { userAgent: USER_AGENT, devicePixelRatio: 2, pageLang: 'en' }, build: BUILD, languages: ENV.languages, record }
  return { input, browser: { id: c.id, prediction: { layout, observation: { codePoints: [], nodes: [], elements: [], unobservable: [] }, painterLimits: predictor.limits(hook) }, questions: { predict: 'all', observe: 'all', contexts: measure.contexts.length } } }
}

describe('offline replay', () => {
  test('the recorder and the library\'s own call log agree, so the record holds what the library asked', () => {
    const { input } = recordInBrowser(testCase('The quick brown fox jumps over the lazy dog', 120))
    expect(input.record.library).toMatchObject({ agrees: true })
    expect(input.record.phases.predict[1] - input.record.phases.predict[0]).toBeGreaterThan(5)
  })

  test('the replay gives the recorded layout and painter limits back, and asks exactly the recorded questions in order', () => {
    const { input, browser } = recordInBrowser(testCase('The quick brown fox jumps over the lazy dog', 120))
    const replayed = replayCase(input, predictor)
    if (replayed.kind !== 'done' || 'error' in replayed.value.prediction || 'error' in browser.prediction) throw new Error('the replay made no layout')
    expect(JSON.stringify(replayed.value.prediction.layout)).toBe(JSON.stringify(browser.prediction.layout))
    expect(replayed.value.prediction.layout.lines.length).toBeGreaterThan(2)
    expect(replayed.value.prediction.painterLimits).toEqual(browser.prediction.painterLimits)
    expect(replayed.value.questions).toEqual(browser.questions)
    // Deterministic: the same input gives the same bytes.
    expect(JSON.stringify(replayCase(input, predictor))).toBe(JSON.stringify(replayed))
  })

  test('a changed prediction is named by its first differing field', () => {
    const { input } = recordInBrowser(testCase('The quick brown fox jumps over the lazy dog', 120))
    const reference = replayCase(input, predictor)
    // An engine whose arithmetic changed: the same questions, and the second line one LayoutUnit wider.
    const wider = {
      ...predictor,
      predict: (c: Case, env: PredictEnv) => {
        const hook = predictor.predict(c, env) as LayoutPrediction
        if (hook.layout.engine === 'blink') hook.layout.lines[1]!.geometry.width += 1
        return hook
      },
    }
    const changed = replayCase(input, wider)
    if (reference.kind !== 'done' || changed.kind !== 'done') throw new Error('the replay asked something the record lacks')
    expect(firstDifference(reference.value.prediction, changed.value.prediction)).toMatchObject({ path: 'layout.lines[1].geometry.width' })
    expect(changed.value.questions).toEqual(reference.value.questions)
  })

  test('a question the record doesn\'t hold is never answered: the case needs the browser', () => {
    const { input } = recordInBrowser(testCase('The quick brown fox jumps over the lazy dog', 120))
    const larger = { ...predictor, predict: (c: Case, env: PredictEnv) => predictor.predict({ ...c, paragraph: { ...c.paragraph, font: font('Arial', 17), runs: c.paragraph.runs.map(run => ({ ...run, font: font('Arial', 17) })) } }, env) }
    const replayed = replayCase(input, larger)
    expect(replayed).toMatchObject({ kind: 'new-question', phase: 'predict' })
    if (replayed.kind === 'new-question') expect(replayed.question).toContain('is not in the record')
  })

  test('the replay leaves the globals as it found them', () => {
    const { input } = recordInBrowser(testCase('ab cd', 100))
    const segment = Intl.Segmenter.prototype.segment
    const canvas = globals['OffscreenCanvas']
    replayCase(input, predictor)
    expect(Intl.Segmenter.prototype.segment).toBe(segment)
    expect(globals['OffscreenCanvas']).toBe(canvas)
  })
})

describe('asked, distinct and call sites', () => {
  test('the replay counts what it was asked, the distinct questions and the contexts it made', () => {
    const { input, browser } = recordInBrowser(testCase('The quick brown fox jumps over the lazy dog', 120))
    const replayed = replayCase(input, predictor)
    if (replayed.kind !== 'done') throw new Error('the replay asked something the record lacks')
    const recorded = input.record.phases.predict[1] - input.record.phases.predict[0]
    expect(replayed.counts.predict.asked).toBe(recorded)
    expect(replayed.counts.predict.distinct).toBeLessThanOrEqual(recorded)
    expect(replayed.counts.predict.distinct).toBeGreaterThan(5)
    // The replay's own count of contexts is the one the library's log gave the recorded row.
    expect(replayed.value.questions!.contexts).toBe(browser.questions!.contexts)
  })

  test('a library that asks everything twice replays to the same prediction, and its questions are repeats only', () => {
    const { input } = recordInBrowser(testCase('The quick brown fox jumps over the lazy dog', 120))
    const reference = replayCase(input, predictor)
    // Every context answers every question twice: what a library without its memo does to the first of two equal asks.
    const twice = {
      ...predictor,
      predict: (c: Case, env: PredictEnv) => {
        const Canvas = globals['OffscreenCanvas'] as new () => { getContext(): { measureText(text: string): unknown } }
        globals['OffscreenCanvas'] = class {
          getContext(): unknown {
            const context = new Canvas().getContext()
            const measureText = context.measureText.bind(context)
            context.measureText = (text: string): unknown => {
              measureText(text)
              return measureText(text)
            }
            return context
          }
        }
        try {
          return predictor.predict(c, env)
        } finally {
          globals['OffscreenCanvas'] = Canvas
        }
      },
    }
    const repeated = replayCase(input, twice)
    if (reference.kind !== 'done' || repeated.kind !== 'done') throw new Error('the replay asked something the record lacks')
    expect(firstDifference(reference.value.prediction, repeated.value.prediction)).toBeNull()
    expect(repeated.counts.predict.asked).toBe(2 * reference.counts.predict.asked)
    expect(repeated.counts.predict.distinct).toBe(reference.counts.predict.distinct)
    expect(classifyQuestions(input.record, reference.value.questions!, repeated.value.questions!).change).toBe('repeats only')
  })

  test('--sites names the library frames that asked, innermost first, without the measurer every call passes through', () => {
    const { input } = recordInBrowser(testCase('The quick brown fox jumps over the lazy dog', 120))
    const tally = newSiteTally()
    const replayed = replayCase(input, predictor, tally)
    if (replayed.kind !== 'done') throw new Error('the replay asked something the record lacks')
    let asks = 0
    for (const [site, counts] of tally.sites) {
      asks += counts.asks
      expect(site).not.toContain('measure/canvas.ts')
      expect(site).toMatch(/^\S+@(engines\/blink|measure)\/[a-z-]+\.ts:\d+/)
    }
    expect(asks).toBe(replayed.counts.predict.asked)
    // Every question sits under the engine's prepare or its line filling.
    expect([...tally.under.keys()].some(owner => owner.includes('engines/blink/'))).toBe(true)
  })

  test('siteOf reads named and anonymous frames and skips what is outside rebuild/src', () => {
    const stack = [
      'Error', '    at measureText (/w/rebuild/lab/measurements.ts:140:25)', '    at measureText (/w/rebuild/src/measure/canvas.ts:82:43)',
      '    at raw16Of (/w/rebuild/src/engines/blink/shape.ts:106:10)', '    at /w/rebuild/src/engines/blink/shape.ts:397:20', '    at pairAdjust16 (/w/rebuild/src/engines/blink/shape.ts:574:12)',
      '    at lineEdgeGaps (/w/rebuild/src/engines/blink/index.ts:240:9)', '    at predict (/w/rebuild/lab/predictor-core.ts:120:30)',
    ].join('\n')
    expect(siteOf(stack)).toEqual({
      site: 'raw16Of@engines/blink/shape.ts:106 < (anonymous)@engines/blink/shape.ts:397 < pairAdjust16@engines/blink/shape.ts:574',
      under: ['raw16Of@engines/blink/shape.ts', '(anonymous)@engines/blink/shape.ts', 'pairAdjust16@engines/blink/shape.ts', 'lineEdgeGaps@engines/blink/index.ts'],
    })
  })
})

describe('how questions changed', () => {
  // Context 0 is asked a, b, c and context 1 is asked a; the record also holds a second call of b on context 0.
  const call = (context: number, text: string): RecordedCall => [context, text, 1, 0, 1, 1, 0]
  const calls = [call(0, 'a'), call(0, 'b'), call(1, 'a'), call(0, 'c'), call(0, 'b')]
  const phase: [number, number] = [0, calls.length]
  const change = (before: 'all' | number[], after: 'all' | number[]): string => classifyAsked(calls, phase, before, after).change

  test('the same questions asked again, or less often, are repeats only', () => {
    expect(change('all', 'all')).toBe('same')
    expect(change('all', [0, 0, 1, 1, 2, 3, 3, 4, 4])).toBe('repeats only')
    // The recorded repeat of b no longer asked: fewer repeats.
    expect(change('all', [0, 1, 2, 3])).toBe('repeats only')
    // The contexts take turns in another order; each context keeps its own.
    const turns = classifyAsked(calls, phase, 'all', [2, 0, 1, 3, 4])
    expect(turns.change).toBe('repeats only')
    expect(turns.detail).toContain('contexts take turns in another order')
  })

  test('a subset in the reference\'s order is dropped only', () => {
    expect(change('all', [0, 2, 3])).toBe('dropped only')
    expect(classifyAsked(calls, phase, 'all', [0, 2, 3]).detail).toContain('1 dropped')
    expect(change('all', [])).toBe('dropped only')
  })

  test('another order within a context, or a recorded question the reference didn\'t ask, is accepted by no step', () => {
    expect(change('all', [1, 0, 2, 3, 4])).toBe('other questions')
    expect(change('all', [3, 0, 1, 2])).toBe('other questions')
    // A reference frozen after b was dropped, and a library that asks it again.
    expect(change([0, 2, 3], 'all')).toBe('other questions')
    expect(classifyAsked(calls, phase, [0, 2, 3], 'all').detail).toContain('1 recorded questions the reference didn\'t ask')
  })

  test('fewer contexts go with dropped questions only; any other change of their number is other questions', () => {
    const record = { calls, phases: { native: [0, 0], predict: phase, observe: [calls.length, calls.length], paint: [calls.length, calls.length] } } as unknown as CaseMeasurements
    const questions = (predict: 'all' | number[], contexts: number) => ({ predict, observe: 'all' as const, contexts })
    expect(classifyQuestions(record, questions('all', 2), questions('all', 2)).change).toBe('same')
    expect(classifyQuestions(record, questions('all', 2), questions([0, 1, 3, 4], 1)).change).toBe('dropped only')
    expect(classifyQuestions(record, questions('all', 2), questions('all', 1)).change).toBe('other questions')
    expect(classifyQuestions(record, questions('all', 2), questions([0, 1, 3, 4], 3)).change).toBe('other questions')
    // A format 1 reference also holds the library's memo hits, which nothing compares.
    expect(classifyQuestions(record, { ...questions('all', 2), memoHits: 7 } as ReturnType<typeof questions>, questions('all', 2)).change).toBe('same')
  })
})

describe('firstDifference', () => {
  test('walks keys and indices in order and cuts long values short', () => {
    expect(firstDifference({ a: [1, { b: 2 }], c: 3 }, { a: [1, { b: 2 }], c: 3 })).toBeNull()
    expect(firstDifference({ a: [1, { b: 2 }], c: 3 }, { a: [1, { b: 5 }], c: 4 })).toEqual({ path: 'a[1].b', before: '2', after: '5' })
    expect(firstDifference({ a: [1, 2] }, { a: [1, 2, 3] })).toEqual({ path: 'a.length', before: '2', after: '3' })
    expect(firstDifference({ a: 1 }, { a: 1, gaps: [] })).toEqual({ path: 'gaps', before: 'absent', after: '[]' })
    expect(firstDifference({ a: 'x'.repeat(400) }, { a: 1 })!.before.length).toBe(160)
  })
})
