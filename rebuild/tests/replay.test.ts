// Tier 1's loop with no browser at all: a fake Canvas stands in for one, lab/record.ts records what the library asks it,
// and the replay must give the recorded prediction back, name a changed one by its first field, and refuse to guess an
// answer the record doesn't hold.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { beginCase, beginPhase, endCase, installRecorder } from '../lab/record.ts'
import { makeCase } from '../lab/cases/case.ts'
import { font, paragraph, text } from '../lab/cases/build.ts'
import * as predictor from '../lab/baselines/no-facts-predictor.ts'
import type { PredictEnv } from '../lab/predictor-core.ts'
import type { Case, LayoutPrediction } from '../lab/types.ts'
import { firstDifference, replayCase, type InputCase, type ReferenceCase } from './replay.ts'

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
  return { input, browser: { id: c.id, prediction: { layout, observation: { codePoints: [], nodes: [], elements: [], unobservable: [] }, painterLimits: predictor.limits(hook) }, questions: { predict: 'all', observe: 'all', contexts: measure.contexts.length, memoHits: measure.memoHits } } }
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

describe('firstDifference', () => {
  test('walks keys and indices in order and cuts long values short', () => {
    expect(firstDifference({ a: [1, { b: 2 }], c: 3 }, { a: [1, { b: 2 }], c: 3 })).toBeNull()
    expect(firstDifference({ a: [1, { b: 2 }], c: 3 }, { a: [1, { b: 5 }], c: 4 })).toEqual({ path: 'a[1].b', before: '2', after: '5' })
    expect(firstDifference({ a: [1, 2] }, { a: [1, 2, 3] })).toEqual({ path: 'a.length', before: '2', after: '3' })
    expect(firstDifference({ a: 1 }, { a: 1, gaps: [] })).toEqual({ path: 'gaps', before: 'absent', after: '[]' })
    expect(firstDifference({ a: 'x'.repeat(400) }, { a: 1 })!.before.length).toBe(160)
  })
})
